'use strict';
const t = require('./minimal-test-harness.cjs');
const D = require('../lib/doctor-checks.cjs');

const orch = { protocol: 1, rigVersion: '2.0.0', hash: 'h1', originUrl: 'git@github.com:o/r.git' };
const facts = (over = {}) => ({
  platform: 'linux', claude: { auth: { loggedIn: true }, tokenInEnv: true }, diskFreeGiB: 50, sharesConsoleUser: false, integrityHash: 'h1',
  repo: { exists: true, isGit: true, clean: true, originUrl: 'https://tok:x@github.com/o/r.git', identity: { name: 'n', email: 'e' } },
  runs: { lost: [], old: 0, staleRunners: [] }, ...over,
});
const boot = { ssh: { ok: true }, node: { ok: true, detail: 'v20' }, claude: { ok: true, detail: '2.1.300' } };
const input = (over = {}) => ({ name: 'm', cfg: { os: 'linux' }, boot, info: { protocol: 1, rigVersion: '2.0.0' }, facts: facts(), push: { ok: true }, orch, ...over });
const status = (cs, id) => cs.find((c) => c.id === id).status;

t.test('healthy machine has no failures; origins compare across ssh/https forms', () => {
  const cs = D.evaluateMachine(input());
  t.ok(!D.hasFailure(cs), JSON.stringify(cs.filter((c) => c.status !== 'ok')));
  t.eq(D.normalizeOrigin('git@github.com:o/r.git'), D.normalizeOrigin('https://u:p@GitHub.com/o/r'));
});
t.test('bootstrap failure stops before worker checks', () => {
  const cs = D.evaluateMachine(input({ boot: { ...boot, node: { ok: false, detail: 'use abs path' } }, info: null, facts: null }));
  t.eq(cs.map((c) => c.id), ['ssh', 'node', 'claude']);
  t.ok(D.hasFailure(cs));
});
t.test('integrity: same version diff hash fails; diff version warns', () => {
  t.eq(status(D.evaluateMachine(input({ facts: facts({ integrityHash: 'zz' }) })), 'rig-version'), 'fail');
  t.eq(status(D.evaluateMachine(input({ info: { protocol: 1, rigVersion: '1.9.0' }, facts: facts({ integrityHash: 'zz' }) })), 'rig-version'), 'warn');
});
t.test('disk thresholds, macOS auth warn, origin mismatch, push failure, stale warn', () => {
  t.eq(status(D.evaluateMachine(input({ facts: facts({ diskFreeGiB: 5 }) })), 'disk'), 'warn');
  t.eq(status(D.evaluateMachine(input({ facts: facts({ diskFreeGiB: 1 }) })), 'disk'), 'fail');
  t.eq(status(D.evaluateMachine(input({ facts: facts({ platform: 'darwin', claude: { auth: { loggedIn: true }, tokenInEnv: false } }) })), 'auth'), 'warn');
  const bad = facts(); bad.repo = { ...bad.repo, originUrl: 'git@github.com:x/y.git' };
  t.eq(status(D.evaluateMachine(input({ facts: bad })), 'repo'), 'fail');
  t.eq(status(D.evaluateMachine(input({ push: { ok: false, detail: 'denied' } })), 'push-detached'), 'fail');
  t.eq(status(D.evaluateMachine(input({ facts: facts({ runs: { lost: [], old: 0, staleRunners: ['rig-abc'] } }) })), 'stale'), 'warn');
});
t.test('windows headless + https origin warns; interactive does not; no creds leak', () => {
  const f = facts(); f.repo = { ...f.repo, originUrl: 'https://github.com/o/r.git' };
  const win = (cfg) => D.evaluateMachine(input({ cfg: { os: 'windows', ...cfg }, facts: f }));
  const w = win({}).find((c) => c.id === 'headless-https');
  t.eq(w.status, 'warn'); t.ok(w.msg.includes('taskMode: interactive'));
  t.ok(!win({ taskMode: 'interactive' }).some((c) => c.id === 'headless-https'));
  t.ok(!JSON.stringify(D.evaluateMachine(input({ facts: facts({ repo: { ...facts().repo, originUrl: 'https://tok:secret@evil/x.git' } }) }))).includes('secret'));
});
t.test('baseline check: match ok, missing/mismatch/quarantined fail with a setup fix, older worker warns', () => {
  const withRepo = (over) => { const f = facts(); f.repo = { ...f.repo, ...over }; return D.evaluateMachine(input({ cfg: { os: 'linux', ssh: 'rig@m', repo: '/r' }, facts: f })); };
  t.eq(status(withRepo({ baseline: 'match' }), 'baseline'), 'ok');
  for (const over of [{ baseline: 'missing' }, { baseline: 'mismatch' }, { baseline: 'match', quarantined: true }]) {
    const c = withRepo(over).find((x) => x.id === 'baseline');
    t.eq(c.status, 'fail', JSON.stringify(over));
    t.ok(/remote\.cjs setup m/.test(c.fix), c.fix);
  }
  t.eq(status(withRepo({}), 'baseline'), 'warn');
});
t.test('fix hints: ssh cause-specific, ok checks have none, missing node points at an abs path', () => {
  const cfg = { os: 'linux', ssh: 'rig@m', repo: '/r' };
  const sshFail = (detail) => D.evaluateMachine(input({ cfg, boot: { ...boot, ssh: { ok: false, detail } }, info: null, facts: null })).find((c) => c.id === 'ssh').fix;
  t.ok(sshFail('Permission denied (publickey)').includes('ssh-copy-id rig@m'));
  t.ok(sshFail('Host key verification failed.').includes('interactively'));
  t.ok(D.evaluateMachine(input({ cfg })).filter((c) => c.status === 'ok').every((c) => !c.fix));
  const node = D.evaluateMachine(input({ cfg, boot: { ...boot, node: { ok: false, detail: 'x' } }, info: null, facts: null })).find((c) => c.id === 'node');
  t.ok(node.fix.includes('"node"') && node.fix.includes('command -v node'), node.fix);
  const win = D.evaluateMachine(input({ cfg: { ...cfg, os: 'windows' }, boot: { ...boot, node: { ok: false, detail: 'x' } }, info: null, facts: null })).find((c) => c.id === 'node');
  t.ok(win.fix.includes('where.exe node'), win.fix);
  const reach = D.withFixHints([{ id: 'reach', status: 'fail', msg: 'm: worker command not found on the machine' }], { name: 'm', cfg })[0];
  t.ok(reach.fix.includes('install-kit-from-local-repo.cjs --global'), reach.fix);
});
t.test('machine-id: match ok, mismatch fails with per-os RIG_MACHINE fix, missing warns, junk is not echoed', () => {
  const cfg = { os: 'linux', ssh: 'rig@m', repo: '/r' };
  const mid = (info, c = cfg) => D.evaluateMachine(input({ cfg: c, info: { protocol: 1, rigVersion: '2.0.0', ...info } })).find((x) => x.id === 'machine-id');
  t.eq(mid({ machine: 'm' }).status, 'ok');
  const bad = mid({ machine: 'other' });
  t.eq(bad.status, 'fail');
  t.ok(bad.fix.includes('RIG_MACHINE=m') && bad.fix.includes('.zshenv') && bad.fix.includes('rename registry key "m" to "other"'), bad.fix);
  const win = mid({ machine: 'other' }, { ...cfg, os: 'windows' });
  t.ok(win.fix.includes('setx RIG_MACHINE m'), win.fix);
  const old = mid({});
  t.eq(old.status, 'warn'); t.ok(old.fix.includes('install-kit-from-local-repo.cjs'), old.fix);
  const junk = mid({ machine: `X; rm -rf /${'a'.repeat(100)}` });
  t.eq(junk.status, 'fail'); t.ok(junk.msg.length < 120 && !junk.fix.includes('rename'), junk.msg);
  t.eq(D.machineIdCheck('m', { machine: 'm' }).status, 'ok');
});
t.done();
