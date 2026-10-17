'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const { makeRepoWithBareRemote } = require('./temp-git-repo-with-bare-remote.cjs');
const { writePlan } = require('./coord-plan-fixture.cjs');
const { ensureLocalWorktree } = require('../lib/rig-local-worktree.cjs');
const S = require('../lib/coord-branch-sync.cjs');

const SLUG = 'demo-plan';
const GHP = 'ghp_' + 'z'.repeat(36);

function setup() {
  const env = makeRepoWithBareRemote({ clones: ['a'] });
  const a = env.clone('a');
  const plansDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-plans-'));
  const planDir = writePlan(plansDir, SLUG, { orchestrator: 'mac', extra: { 'notes.md': `token ${GHP}\r\n`, 'big.md': 'x'.repeat(1024 * 1024 + 1) } });
  const { dir } = ensureLocalWorktree(a, S.coordDirName(SLUG), `rig-coord/${SLUG}`, { orphan: true });
  return { env, a, planDir, dir, cleanup: () => { env.cleanup(); fs.rmSync(plansDir, { recursive: true, force: true }); } };
}
const withSetup = (fn) => () => { const s = setup(); try { return fn(s); } finally { s.cleanup(); } };
const tree = (s) => s.env.git(s.dir, 'ls-tree', '-r', '--name-only', 'HEAD').split('\n').filter(Boolean);
const mirror = (s) => S.mirrorPlanToCoord(s.planDir, s.dir, { slug: SLUG, self: 'mac' });

t.test('mirror excludes reports/visuals/logs/dotfiles/big, redacts, keeps CRLF, main untouched', withSetup((s) => {
  const headBefore = s.env.git(s.a, 'rev-parse', 'HEAD');
  const r = mirror(s);
  t.ok(r.committed);
  t.eq(tree(s), ['notes.md', 'phase-01-setup.md', 'plan.md']);
  t.ok(r.warnings.some((w) => w.includes('big.md')));
  t.eq(r.redactions[0].file, 'notes.md');
  t.eq(fs.readFileSync(path.join(s.dir, 'notes.md'), 'utf8'), 'token [REDACTED]\r\n');
  t.ok(fs.readFileSync(path.join(s.dir, 'plan.md'), 'utf8').includes('# Plan\r\nline with CRLF\r\n'));
  t.ok(/^coord: demo-plan \d{4}-.* by mac$/.test(s.env.git(s.dir, 'log', '-1', '--format=%s')));
  t.eq(s.env.git(s.a, 'status', '--porcelain'), '');
  t.eq(s.env.git(s.a, 'rev-parse', 'HEAD'), headBefore);
  t.ok(fs.readFileSync(path.join(s.planDir, 'notes.md'), 'utf8').includes(GHP)); // source never rewritten
}));

t.test('second mirror is a no-op commit; deletes propagate', withSetup((s) => {
  mirror(s);
  const before = s.env.git(s.dir, 'rev-parse', 'HEAD');
  t.eq(mirror(s).committed, false);
  t.eq(s.env.git(s.dir, 'rev-parse', 'HEAD'), before);
  fs.rmSync(path.join(s.planDir, 'notes.md'));
  t.ok(mirror(s).committed);
  t.eq(tree(s), ['phase-01-setup.md', 'plan.md']);
}));

t.test('push publishes sans reports/logs/secret; rival orphan push is rejected (create-only)', withSetup((s) => {
  t.eq(S.remoteCoordState(s.a, SLUG), { state: 'missing', sha: null });
  mirror(s);
  S.pushCoord(s.dir, SLUG);
  const st = S.remoteCoordState(s.a, SLUG);
  t.eq(st.state, 'present');
  const remoteTree = s.env.git(s.env.origin, 'ls-tree', '-r', '--name-only', `rig-coord/${SLUG}`);
  t.ok(!/reports|\.log|visuals/.test(remoteTree), remoteTree);
  t.ok(!s.env.git(s.env.origin, 'show', `rig-coord/${SLUG}:notes.md`).includes('ghp_'));
  const other = ensureLocalWorktree(s.a, 'coord-other', 'rig-coord/other-local', { orphan: true }).dir;
  fs.writeFileSync(path.join(other, 'plan.md'), 'x\n');
  s.env.git(other, 'add', '-A');
  s.env.git(other, 'commit', '-q', '-m', 'rival');
  t.throwsRemote(() => S.pushCoord(other, SLUG), { exitCode: 3, cls: 'coord-moved' });
  t.eq(S.remoteCoordState(s.a, SLUG).sha, st.sha);
}));

t.test('bogus origin: remoteCoordState and fetchCoord fail closed (exit 3)', withSetup((s) => {
  s.env.git(s.a, 'remote', 'set-url', 'origin', path.join(s.env.root, 'missing-remote'));
  t.throwsRemote(() => S.remoteCoordState(s.a, SLUG), { exitCode: 3, cls: 'coord-unverifiable' });
  t.throwsRemote(() => S.fetchCoord(s.a, SLUG), { exitCode: 3, cls: 'coord-unverifiable' });
}));

t.done();
