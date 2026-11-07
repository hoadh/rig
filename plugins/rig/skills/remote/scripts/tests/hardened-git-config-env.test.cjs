'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const t = require('./minimal-test-harness.cjs');
const { GIT_NULL_CONFIG } = require('./platform-test-fixtures.cjs');
const { makeRepoWithBareRemote } = require('./temp-git-repo-with-bare-remote.cjs');
const H = require('../lib/hardened-git-config-env.cjs');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-hardened-env-'));
process.env.RIG_HOME = home;
process.on('exit', () => fs.rmSync(home, { recursive: true, force: true }));

const entries = (env) => Array.from({ length: Number(env.GIT_CONFIG_COUNT) }, (_, i) => [env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]]);

t.test('env additions pin the dangerous keys and ignore the system config', () => {
  const env = H.hardenedGitConfigEnv();
  t.eq(env.GIT_CONFIG_NOSYSTEM, '1');
  const e = Object.fromEntries(entries(env));
  t.eq(e['core.hooksPath'], H.pinnedHooksPath()); // /dev/null on Unix, verified empty dir on win32
  t.eq([e['core.sshCommand'], e['core.fsmonitor'], e['protocol.ext.allow'], e['core.askPass']], ['ssh', 'false', 'never', '']);
  t.ok(!('credential.helper' in e), 'credential.helper unpinned by default');
});

t.test('noSystem:false keeps the root-owned system config (credential helper) for runner git', () => {
  const env = H.hardenedGitConfigEnv({ noSystem: false });
  t.ok(!('GIT_CONFIG_NOSYSTEM' in env));
  t.eq(Object.fromEntries(entries(env))['core.hooksPath'], H.pinnedHooksPath());
});

t.test('credentialHelper opt-in resets inherited helpers then sets the pinned one; bad values rejected', () => {
  const list = entries(H.hardenedGitConfigEnv({ credentialHelper: 'store' })).filter(([k]) => k === 'credential.helper');
  t.eq(list, [['credential.helper', ''], ['credential.helper', 'store']]);
  t.assert.throws(() => H.hardenedGitConfigEnv({ credentialHelper: 'a\nb' }));
  t.assert.throws(() => H.hardenedGitConfigEnv({ credentialHelper: 5 }));
});

t.test('existing GIT_CONFIG_COUNT entries are continued, not clobbered; garbage count rejected', () => {
  const base = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'x' };
  const add = H.hardenedGitConfigEnv({ baseEnv: base });
  t.ok(!('GIT_CONFIG_KEY_0' in add));
  t.eq(add.GIT_CONFIG_KEY_1, 'core.hooksPath');
  t.eq(Number(add.GIT_CONFIG_COUNT), 1 + 5);
  const bad = (() => { try { H.hardenedGitConfigEnv({ baseEnv: { GIT_CONFIG_COUNT: '-1' } }); } catch (e) { return e; } return null; })();
  t.ok(bad && bad.failure === 'prepare' && bad.extra.hint, 'RunFailure with hint (L4)');
});

t.test('real git: repo-local config cannot override the pinned values; a hook does not run', () => {
  const env = makeRepoWithBareRemote({ clones: ['w'] });
  try {
    const repo = env.clone('w');
    env.git(repo, 'config', 'core.sshCommand', 'evil-ssh');
    env.git(repo, 'config', 'core.hooksPath', path.join(repo, 'evil-hooks'));
    const marker = path.join(repo, 'hook-ran');
    fs.mkdirSync(path.join(repo, 'evil-hooks'));
    fs.writeFileSync(path.join(repo, 'evil-hooks', 'pre-commit'), `#!/bin/sh\ntouch "${marker}"\n`, { mode: 0o755 });
    const childEnv = { ...process.env, GIT_CONFIG_GLOBAL: GIT_NULL_CONFIG, ...H.hardenedGitConfigEnv({ baseEnv: process.env }) };
    const get = (k) => execFileSync('git', ['-C', repo, 'config', '--get', k], { encoding: 'utf8', env: childEnv }).trim();
    t.eq(get('core.sshCommand'), 'ssh');
    t.eq(get('core.hooksPath'), H.pinnedHooksPath());
    fs.writeFileSync(path.join(repo, 'f.txt'), 'x');
    execFileSync('git', ['-C', repo, 'add', 'f.txt'], { env: childEnv });
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'x'], { env: childEnv });
    t.ok(!fs.existsSync(marker), 'pre-commit hook from tampered hooksPath must not run');
  } finally { env.cleanup(); }
});

t.test('baseline: missing -> write -> match -> tamper -> mismatch; stored outside clone', () => {
  const env = makeRepoWithBareRemote({ clones: ['w'] });
  try {
    const repo = env.clone('w');
    t.eq(H.verifyKnownGoodBaseline(repo).status, 'missing');
    t.eq(H.readKnownGoodBaseline(repo), null);
    const h = H.knownGoodGitControlBaseline.write(repo);
    t.ok(H.baselinePath(repo).startsWith(home) && /git-baseline-[0-9a-f]{16}\.json$/.test(H.baselinePath(repo)));
    t.eq(H.verifyKnownGoodBaseline(repo), { ok: true, status: 'match', expected: h, actual: h });
    env.git(repo, 'config', 'credential.helper', '!evil');
    const v = H.knownGoodGitControlBaseline.verify(repo);
    t.eq([v.ok, v.status], [false, 'mismatch']);
    t.ok(v.expected === h && v.actual !== h);
    fs.writeFileSync(H.baselinePath(repo), '{not json');
    t.eq(H.readKnownGoodBaseline(repo), null);
    t.eq(H.verifyKnownGoodBaseline(repo).status, 'missing');
    t.ok(H.cloneHash(repo) === H.cloneHash(repo + path.sep + '.'));
  } finally { env.cleanup(); }
});

t.test('H5: unix hooksPath is /dev/null; win32 fallback dir is verified empty and fails closed (hooks-tampered)', () => {
  t.eq(H.pinnedHooksPath('linux'), '/dev/null');
  const dir = path.join(home, 'empty-hooks');
  fs.rmSync(dir, { recursive: true, force: true });
  t.eq(H.assertEmptyHooksDir(), dir); // created
  t.eq(H.pinnedHooksPath('win32'), process.platform === 'win32' ? dir : H.pinnedHooksPath('win32'));
  fs.writeFileSync(path.join(dir, 'pre-push'), 'x');
  const e = (() => { try { H.assertEmptyHooksDir(); } catch (x) { return x; } return null; })();
  t.ok(e && e.failure === 'hooks-tampered' && /pre-push/.test(e.message), 'planted file rejected');
  fs.rmSync(dir, { recursive: true });
  fs.symlinkSync(os.tmpdir(), dir);
  const e2 = (() => { try { H.assertEmptyHooksDir(); } catch (x) { return x; } return null; })();
  t.ok(e2 && e2.failure === 'hooks-tampered', 'symlink rejected');
  fs.unlinkSync(dir);
});

t.test('H5 real git: a pre-push planted in the old ~/.rig/empty-hooks location does not run on safeGit push', () => {
  const { safeGit } = require('../lib/safe-git-runner.cjs');
  const env = makeRepoWithBareRemote({ clones: ['w'] });
  try {
    const repo = env.clone('w');
    const dir = path.join(home, 'empty-hooks');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const marker = path.join(env.root, 'pre-push-ran');
    safeGit(repo, ['commit', '--allow-empty', '-q', '-m', 'x']); // before planting: on win32 a non-empty hooks dir fails every safeGit call closed
    fs.writeFileSync(path.join(dir, 'pre-push'), `#!/bin/sh\ntouch "${marker}"\n`, { mode: 0o755 });
    if (process.platform === 'win32') {
      t.assert.throws(() => safeGit(repo, ['push', 'origin', 'HEAD:refs/heads/h5']), /./); // fails closed
      t.ok(!fs.existsSync(marker), 'planted pre-push must not run (win32 fails closed)');
    } else {
      safeGit(repo, ['push', 'origin', 'HEAD:refs/heads/h5']);
      t.ok(!fs.existsSync(marker), 'planted pre-push must not run');
    }
  } finally { env.cleanup(); }
});

t.test('M-B: global ~/.gitconfig and XDG git config are part of the baseline hash', () => {
  const env = makeRepoWithBareRemote({ clones: ['w'] });
  const saved = { HOME: process.env.HOME, XDG: process.env.XDG_CONFIG_HOME };
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-fakehome-'));
  try {
    process.env.HOME = fakeHome; delete process.env.XDG_CONFIG_HOME;
    const repo = env.clone('w');
    const h0 = H.knownGoodGitControlBaseline.write(repo);
    t.eq(H.verifyKnownGoodBaseline(repo).status, 'match');
    fs.writeFileSync(path.join(fakeHome, '.gitconfig'), '[credential]\n\thelper = !evil\n');
    t.eq(H.verifyKnownGoodBaseline(repo).status, 'mismatch');
    fs.rmSync(path.join(fakeHome, '.gitconfig'));
    t.eq(H.verifyKnownGoodBaseline(repo).expected, h0);
    t.eq(H.verifyKnownGoodBaseline(repo).status, 'match');
    fs.mkdirSync(path.join(fakeHome, '.config', 'git'), { recursive: true });
    fs.writeFileSync(path.join(fakeHome, '.config', 'git', 'config'), '[url "x"]\n\tinsteadOf = y\n');
    t.eq(H.verifyKnownGoodBaseline(repo).status, 'mismatch');
    fs.rmSync(path.join(fakeHome, '.config'), { recursive: true });
    fs.mkdirSync(path.join(env.git(repo, 'rev-parse', '--absolute-git-dir'), 'objects', 'info'), { recursive: true });
    fs.writeFileSync(path.join(env.git(repo, 'rev-parse', '--absolute-git-dir'), 'objects', 'info', 'alternates'), '/tmp/evil-objects\n');
    t.eq(H.verifyKnownGoodBaseline(repo).status, 'mismatch');
  } finally {
    process.env.HOME = saved.HOME; if (saved.XDG !== undefined) process.env.XDG_CONFIG_HOME = saved.XDG;
    fs.rmSync(fakeHome, { recursive: true, force: true }); env.cleanup();
  }
});

t.done();
