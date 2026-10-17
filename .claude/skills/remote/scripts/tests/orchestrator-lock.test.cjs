'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const t = require('./minimal-test-harness.cjs');
const { makeRepoWithBareRemote } = require('./temp-git-repo-with-bare-remote.cjs');
const { writePlan } = require('./coord-plan-fixture.cjs');
const L = require('../lib/orchestrator-lock.cjs');
const S = require('../lib/coord-branch-sync.cjs');
const takeover = require('../commands/takeover-command.cjs');
const { parseFrontmatter } = require('../lib/plan-frontmatter.cjs');

const SLUG = 'lock-plan';
process.env.RIG_MACHINES_FILE = path.join(os.tmpdir(), 'rig-no-such-registry.json'); // takeover scan -> warning only

function setup() {
  const env = makeRepoWithBareRemote({ clones: ['a', 'b'] });
  const plans = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-lock-plans-'));
  const planA = writePlan(path.join(plans, 'a'), SLUG, {});
  const planB = path.join(plans, 'b', SLUG); // does not exist yet on machine b
  return { env, a: env.clone('a'), b: env.clone('b'), planA, planB, cleanup: () => { env.cleanup(); fs.rmSync(plans, { recursive: true, force: true }); } };
}
const withSetup = (fn) => async () => { const s = setup(); const cwd = process.cwd(); try { await fn(s); } finally { process.chdir(cwd); s.cleanup(); } };
const orchestratorOf = (file) => parseFrontmatter(fs.readFileSync(file, 'utf8')).orchestrator;

t.test('first call claims (create-only), writes orchestrator, second call rechecks', withSetup((s) => {
  const r = L.assertOrchestrator(s.a, s.planA, 'mac');
  t.ok(r.claimed);
  t.eq(orchestratorOf(path.join(s.planA, 'plan.md')), 'mac');
  t.eq(S.remoteCoordState(s.a, SLUG).state, 'present');
  const again = L.assertOrchestrator(s.a, s.planA, 'mac');
  t.eq(again.claimed, false);
  t.eq(again.coordSha, S.remoteCoordState(s.a, SLUG).sha);
  t.eq(s.env.git(s.a, 'status', '--porcelain'), '');
}));

t.test('other machine is refused with exit 3 locked', withSetup((s) => {
  L.assertOrchestrator(s.a, s.planA, 'mac');
  const e = t.throwsRemote(() => L.assertOrchestrator(s.b, s.planB, 'waso'), { exitCode: 3, cls: 'locked' });
  t.ok(/locked by mac/.test(e.message));
  t.ok(!fs.existsSync(path.join(s.b, '.rig', 'coord-lock-plan')));
}));

t.test('claim loses a race at push: exit 3, local worktree cleaned, plan.md restored', withSetup((s) => {
  // b probes "missing", a claims, then b's claim push must be rejected.
  const origProbe = S.remoteCoordState;
  let raced = false; // one-shot, else the nested claim would recurse
  S.remoteCoordState = (...args) => {
    const r = origProbe(...args);
    if (!raced) { raced = true; L.assertOrchestrator(s.a, s.planA, 'mac'); }
    return r;
  };
  try {
    writePlan(path.dirname(s.planB), SLUG, { orchestrator: 'prev' });
    t.throwsRemote(() => L.assertOrchestrator(s.b, s.planB, 'waso'), { exitCode: 3, cls: 'coord-moved' });
  } finally { S.remoteCoordState = origProbe; }
  t.ok(!fs.existsSync(path.join(s.b, '.rig', 'coord-lock-plan')));
  t.eq(orchestratorOf(path.join(s.planB, 'plan.md')), 'prev');
}));

t.test('two processes claim concurrently: exactly one wins, other exit 3', withSetup(async (s) => {
  writePlan(path.dirname(s.planB), SLUG, {});
  const code = 'const L=require(process.argv[1]);try{L.assertOrchestrator(process.argv[2],process.argv[3],process.argv[4]);process.exit(0)}catch(e){console.error(e.message);process.exit(e.exitCode||1)}';
  const libPath = require.resolve('../lib/orchestrator-lock.cjs');
  const run = (repo, plan, self) => new Promise((res) => {
    const c = spawn(process.execPath, ['-e', code, libPath, repo, plan, self], { stdio: 'ignore' });
    c.on('close', res);
  });
  const codes = (await Promise.all([run(s.a, s.planA, 'mac'), run(s.b, s.planB, 'waso')])).sort();
  t.eq(codes, [0, 3]);
}));

t.test('unreachable origin: never claims, exit 3', withSetup((s) => {
  s.env.git(s.a, 'remote', 'set-url', 'origin', path.join(s.env.root, 'missing-remote'));
  t.throwsRemote(() => L.assertOrchestrator(s.a, s.planA, 'mac'), { exitCode: 3, cls: 'coord-unverifiable' });
  t.throwsRemote(() => L.syncCoord(s.a, s.planA, 'mac'), { exitCode: 3 });
  t.ok(!fs.existsSync(path.join(s.a, '.rig', 'coord-lock-plan')));
  t.ok(!/orchestrator: mac/.test(fs.readFileSync(path.join(s.planA, 'plan.md'), 'utf8')));
}));

t.test('coord deleted on remote while local worktree exists: exit 3, no reclaim', withSetup((s) => {
  L.assertOrchestrator(s.a, s.planA, 'mac');
  s.env.git(s.env.origin, 'update-ref', '-d', `refs/heads/rig-coord/${SLUG}`);
  t.throwsRemote(() => L.assertOrchestrator(s.a, s.planA, 'mac'), { exitCode: 3, cls: 'coord-deleted' });
}));

t.test('syncCoord mirrors edits and pushes', withSetup((s) => {
  L.syncCoord(s.a, s.planA, 'mac');
  fs.writeFileSync(path.join(s.planA, 'phase-02-more.md'), '---\nmachine: waso\n---\nx\n');
  const r = L.syncCoord(s.a, s.planA, 'mac');
  t.ok(r.committed);
  t.ok(s.env.git(s.env.origin, 'ls-tree', '--name-only', `rig-coord/${SLUG}`).includes('phase-02-more.md'));
}));

t.test('takeover: b takes over, old orchestrator a then exit 3; local diff needs --force', withSetup(async (s) => {
  L.syncCoord(s.a, s.planA, 'mac');
  process.chdir(s.b);
  // stale differing local copy on b
  writePlan(path.dirname(s.planB), SLUG, { extra: { 'phase-09-old.md': '---\nmachine: x\n---\n' } });
  await t.rejectsRemote(takeover.run([s.planB], { self: 'waso' }), { exitCode: 1, cls: 'local-differs' });
  t.eq(await takeover.run([s.planB, '--force'], { self: 'waso' }), 0);
  t.ok(fs.readdirSync(path.dirname(s.planB)).some((n) => n.startsWith(`${SLUG}.bak-`)));
  t.eq(orchestratorOf(path.join(s.planB, 'plan.md')), 'waso');
  t.ok(!fs.existsSync(path.join(s.planB, 'phase-09-old.md')));
  t.ok(s.env.git(s.env.origin, 'show', `rig-coord/${SLUG}:plan.md`).includes('orchestrator: waso'));
  t.throwsRemote(() => L.assertOrchestrator(s.a, s.planA, 'mac'), { exitCode: 3, cls: 'locked' });
  t.eq(L.assertOrchestrator(s.b, s.planB, 'waso').claimed, false);
  t.eq(await takeover.run([s.planB], { self: 'waso' }), 0); // already orchestrator
}));

t.test('takeover with nothing on remote -> exit 1; malicious coord tree -> exit 1, nothing written', withSetup(async (s) => {
  process.chdir(s.b);
  await t.rejectsRemote(takeover.run([s.planB], { self: 'waso' }), { exitCode: 1, cls: 'no-coord' });
  // forge a coord branch whose plan.md carries an invalid orchestrator id
  s.env.git(s.a, 'checkout', '-q', '--orphan', 'tmp-evil');
  s.env.git(s.a, 'rm', '-rfq', '.');
  fs.writeFileSync(path.join(s.a, 'plan.md'), '---\norchestrator: "a;b"\n---\n');
  s.env.git(s.a, 'add', 'plan.md');
  s.env.git(s.a, 'commit', '-q', '-m', 'evil');
  s.env.git(s.a, 'push', '-q', 'origin', `HEAD:refs/heads/rig-coord/${SLUG}`);
  await t.rejectsRemote(takeover.run([s.planB], { self: 'waso' }), { exitCode: 1, cls: 'coord-invalid' });
  t.ok(!fs.existsSync(s.planB));
  t.ok(!fs.existsSync(path.join(s.b, '.rig', 'coord-lock-plan')));
}));

t.test('takeover usage errors', async () => {
  await t.rejectsRemote(takeover.run([], { self: 'waso' }), { exitCode: 2 });
  await t.rejectsRemote(takeover.run(['--bogus'], { self: 'waso' }), { exitCode: 2 });
});

t.done();
