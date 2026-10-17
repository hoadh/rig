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
t.done();
