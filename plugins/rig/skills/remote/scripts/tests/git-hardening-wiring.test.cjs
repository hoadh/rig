'use strict';
/** Review H1/M4 wiring: safeGit env pins, agent child env, baseline gate, separate test clone, baseline command. */
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');

process.env.RIG_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-harden-home-'));
const { makeRepoWithBareRemote } = require('./temp-git-repo-with-bare-remote.cjs');
const { gitConfigPath } = require('./platform-test-fixtures.cjs');
const { systemLineEndingPins } = require('../lib/system-line-ending-config-forwarder.cjs');
const { prepareAgentClone } = require('../lib/worker-repo-preparer.cjs');
const { safeGit, tryGit } = require('../lib/safe-git-runner.cjs');
const { prepareTestClone } = require('../lib/worker-test-clone-preparer.cjs');
const { writeKnownGoodBaseline, readKnownGoodBaseline, pinnedHooksPath } = require('../lib/hardened-git-config-env.cjs');
const { hashGitControlFiles, isQuarantined } = require('../lib/git-control-files-integrity.cjs');
const { buildAgentChildEnv } = require('../lib/agent-child-env.cjs');
const { pushWithRetry } = require('../lib/worker-branch-pusher.cjs');

const SLUG = 'plan-a';
const GD = '.' + 'git';
const ENVELOPE = JSON.stringify({ nonce: 'ab'.repeat(16), protocol: 1, payload: null });
const WORKER_CJS = path.join(__dirname, '..', 'worker.cjs');

function fixture() {
  const env = makeRepoWithBareRemote({ clones: ['main', 'w'] });
  const main = env.clone('main');
  env.git(main, 'push', '-q', 'origin', 'main');
  const baseSha = env.git(main, 'rev-parse', 'HEAD');
  env.git(main, 'checkout', '-q', '--orphan', `rig-coord/${SLUG}`);
  env.git(main, 'rm', '-rfq', '.');
  fs.writeFileSync(path.join(main, 'plan.md'), '---\ntitle: x\norchestrator: mac\n---\n');
  env.git(main, 'add', 'plan.md'); env.git(main, 'commit', '-q', '-m', 'coord');
  env.git(main, 'push', '-q', 'origin', `rig-coord/${SLUG}`);
  env.git(main, 'checkout', '-q', 'main');
  const repo = env.clone('w');
  const spec = { orchestrator: 'mac', slug: SLUG, baseSha, startSha: baseSha, branch: `rig/waso/${SLUG}` };
  return { env, repo, spec, baseSha, target: { repo }, cleanup: () => env.cleanup() };
}
const failureOf = (fn) => { try { fn(); } catch (e) { return e.failure; } return 'no-throw'; };
const cfgPath = (repo) => path.join(repo, GD, 'config');

t.test('(a) tampered hooksPath/sshCommand in repo config does not affect safeGit/push; baseline reports hooks-tampered', async () => {
  const f = fixture();
  try {
    writeKnownGoodBaseline(f.repo);
    const marker = path.join(f.env.root, 'evil-ran');
    const evilHooks = path.join(f.env.root, 'evil-hooks');
    fs.mkdirSync(evilHooks);
    fs.writeFileSync(path.join(evilHooks, 'reference-transaction'), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(f.env.root, 'evil-ssh'), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
    fs.appendFileSync(cfgPath(f.repo), `[core]\n\thooksPath = ${gitConfigPath(evilHooks)}\n\tsshCommand = ${gitConfigPath(path.join(f.env.root, 'evil-ssh'))}\n`);
    t.eq(safeGit(f.repo, ['config', '--get', 'core.hooksPath']), pinnedHooksPath());
    t.eq(safeGit(f.repo, ['config', '--get', 'core.sshCommand']), 'ssh');
    safeGit(f.repo, ['commit', '--allow-empty', '-q', '-m', 'x']);
    const head = safeGit(f.repo, ['rev-parse', 'HEAD']);
    const r = await pushWithRetry(f.repo, 'rig/waso/hardening', { head });
    t.ok(r.ok, JSON.stringify(r));
    t.ok(!fs.existsSync(marker), 'tampered hook/ssh must not run');
    // baseline gate: mismatch -> hooks-tampered + quarantine, before any agent run
    t.eq(failureOf(() => prepareAgentClone(f.spec, f.target)), 'hooks-tampered');
    t.ok(isQuarantined(f.repo));
  } finally { f.cleanup(); }
});

t.test('safeGit merges a caller GIT_CONFIG_COUNT instead of clobbering it', () => {
  const f = fixture();
  try {
    const out = safeGit(f.repo, ['config', '--get', 'x.mine'], { env: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'x.mine', GIT_CONFIG_VALUE_0: 'yes' } });
    t.eq(out, 'yes');
    t.eq(safeGit(f.repo, ['config', '--get', 'protocol.ext.allow'], { env: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'x.mine', GIT_CONFIG_VALUE_0: 'yes' } }), 'never');
  } finally { f.cleanup(); }
});

t.test('(b) agent child env: git commit never runs a planted clone hook; no ssh/askpass/global-config leak', () => {
  const f = fixture();
  try {
    const marker = path.join(f.env.root, 'hook-ran');
    fs.writeFileSync(path.join(f.repo, GD, 'hooks', 'pre-commit'), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
    const parent = { ...process.env, GIT_SSH_COMMAND: 'evil', GIT_ASKPASS: '/evil', GIT_CONFIG_GLOBAL: '/evil', GIT_CONFIG_COUNT: '9', SSH_AUTH_SOCK: '/s' };
    const env = buildAgentChildEnv(parent, {});
    for (const k of ['GIT_SSH_COMMAND', 'GIT_ASKPASS', 'GIT_CONFIG_GLOBAL', 'SSH_AUTH_SOCK']) t.ok(!(k in env), `${k} leaked`);
    // allowlist dropped the parent's 9; our 5 pins + forwarded system line-ending pins (Git for Windows: core.autocrlf) survive
    t.eq(env.GIT_CONFIG_COUNT, String(5 + systemLineEndingPins(parent).length));
    t.eq(env.GIT_CONFIG_NOSYSTEM, '1');
    fs.writeFileSync(path.join(f.repo, 'a.txt'), 'a');
    const git = (...a) => cp.execFileSync('git', ['-C', f.repo, ...a], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git('add', '-A'); git('commit', '-q', '-m', 'agent commit');
    t.ok(!fs.existsSync(marker), 'pre-commit hook ran in agent env');
  } finally { f.cleanup(); }
});

t.test('(c) test clone is separate: code run in it cannot alter the agent clone git dir', () => {
  const f = fixture();
  try {
    writeKnownGoodBaseline(f.repo);
    const before = hashGitControlFiles(f.repo);
    const wt = prepareTestClone({ ref: f.baseSha }, f.target).cwd;
    const gd = path.join(wt, GD);
    t.ok(fs.statSync(gd).isDirectory(), 'own git dir, not a worktree link');
    t.eq(fs.existsSync(path.join(gd, 'commondir')), false);
    t.eq(cp.execFileSync('git', ['-C', wt, 'config', '--get', 'remote.origin.url'], { encoding: 'utf8' }).trim(), f.env.origin);
    // "untrusted test code": rewrites its own config/hooks via every relative path it can reach
    cp.execFileSync('git', ['config', 'core.sshCommand', 'evil'], { cwd: wt });
    cp.execFileSync('git', ['config', 'remote.origin.pushurl', 'file:///nowhere'], { cwd: wt });
    fs.writeFileSync(path.join(gd, 'hooks', 'post-checkout'), '#!/bin/sh\n', { mode: 0o755 });
    t.eq(hashGitControlFiles(f.repo), before);
    t.eq(prepareAgentClone(f.spec, f.target).head, f.baseSha); // baseline still matches
    // re-prepare re-points origin at the real remote
    prepareTestClone({ ref: f.baseSha }, f.target);
    t.eq(cp.execFileSync('git', ['-C', wt, 'config', '--get', 'remote.origin.url'], { encoding: 'utf8' }).trim(), f.env.origin);
  } finally { f.cleanup(); }
});

t.test('M-A: test run refuses an agent clone without baseline or with a tampered origin url (before any fetch)', () => {
  const f = fixture();
  try {
    t.eq(failureOf(() => prepareTestClone({ ref: f.baseSha }, f.target)), 'prepare'); // no baseline recorded
    t.ok(!fs.existsSync(`${f.repo}-rig-test`));
    writeKnownGoodBaseline(f.repo);
    f.env.git(f.repo, 'remote', 'set-url', 'origin', 'https://evil.invalid/x.git');
    t.eq(failureOf(() => prepareTestClone({ ref: f.baseSha }, f.target)), 'hooks-tampered');
    t.ok(!fs.existsSync(`${f.repo}-rig-test`), 'no clone from the tampered url');
  } finally { f.cleanup(); }
});

t.test('L6: reused test clone config is rewritten (insteadOf, pushurl, credential, core overrides dropped)', () => {
  const f = fixture();
  try {
    writeKnownGoodBaseline(f.repo);
    const wt = prepareTestClone({ ref: f.baseSha }, f.target).cwd;
    const cfg = path.join(wt, GD, 'config');
    fs.appendFileSync(cfg, '[url "file:///nowhere/"]\n\tinsteadOf = ' + f.env.origin + '\n[remote "origin"]\n\tpushurl = file:///nowhere\n[credential]\n\thelper = !evil\n[core]\n\tsshCommand = evil\n\tfsmonitor = evil\n');
    prepareTestClone({ ref: f.baseSha }, f.target);
    const text = fs.readFileSync(cfg, 'utf8');
    t.ok(!/insteadOf|pushurl|credential|sshCommand|fsmonitor|evil/.test(text), text);
    t.eq(cp.execFileSync('git', ['-C', wt, 'config', '--get', 'remote.origin.url'], { encoding: 'utf8' }).trim(), f.env.origin);
    t.eq(cp.execFileSync('git', ['-C', wt, 'config', '--get', 'core.bare'], { encoding: 'utf8' }).trim(), 'false');
  } finally { f.cleanup(); }
});

t.test('legacy linked worktree `<repo>-rig-test` is migrated to a separate clone', () => {
  const f = fixture();
  try {
    const wt = `${f.repo}-rig-test`;
    f.env.git(f.repo, 'worktree', 'add', '--quiet', '--detach', wt, f.baseSha);
    t.ok(fs.statSync(path.join(wt, GD)).isFile());
    writeKnownGoodBaseline(f.repo);
    prepareTestClone({ ref: f.baseSha }, f.target);
    t.ok(fs.statSync(path.join(wt, GD)).isDirectory());
    t.eq(f.env.git(f.repo, 'worktree', 'list', '--porcelain').includes('rig-test'), false);
  } finally { f.cleanup(); }
});

t.test('(d) existing clone with missing baseline -> failed:prepare; baseline command records it; then prepare works', () => {
  const f = fixture();
  try {
    t.eq(failureOf(() => prepareAgentClone(f.spec, f.target)), 'prepare');
    t.eq(readKnownGoodBaseline(f.repo), null);
    const r = cp.spawnSync(process.execPath, [WORKER_CJS, 'baseline', '--repo', f.repo], { env: { ...process.env, RIG_HOME: process.env.RIG_HOME }, encoding: 'utf8', input: ENVELOPE });
    t.eq(r.status, 0, r.stderr);
    t.eq(readKnownGoodBaseline(f.repo), hashGitControlFiles(f.repo));
    t.eq(prepareAgentClone(f.spec, f.target).head, f.baseSha);
  } finally { f.cleanup(); }
});

t.test('baseline command refuses a quarantined clone and a non-git path', () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.repo, GD, 'rig-quarantine'), 'x');
    const run = (repo) => cp.spawnSync(process.execPath, [WORKER_CJS, 'baseline', '--repo', repo], { env: process.env, encoding: 'utf8', input: ENVELOPE });
    const q = run(f.repo); const n = run(os.tmpdir());
    t.ok(q.status !== 0 && /quarantined/.test(q.stderr), q.stderr);
    t.ok(n.status !== 0 && /not a git clone/.test(n.stderr), n.stderr);
    t.eq(readKnownGoodBaseline(f.repo), null);
    t.ok(tryGit(f.repo, ['status']).ok);
  } finally { f.cleanup(); }
});

t.done().then(() => fs.rmSync(process.env.RIG_HOME, { recursive: true, force: true }));
