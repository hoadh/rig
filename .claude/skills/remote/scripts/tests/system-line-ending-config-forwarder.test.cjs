'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const t = require('./minimal-test-harness.cjs');
const { GIT_NULL_CONFIG } = require('./platform-test-fixtures.cjs');
const F = require('../lib/system-line-ending-config-forwarder.cjs');
const H = require('../lib/hardened-git-config-env.cjs');
const { buildAgentChildEnv } = require('../lib/agent-child-env.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-lineend-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
const entries = (env) => Array.from({ length: Number(env.GIT_CONFIG_COUNT) }, (_, i) => [env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]]);

// GIT_CONFIG_SYSTEM (git >= 2.32) stands in for the system gitconfig.
const gitSupportsSystemVar = (() => {
  try {
    const v = execFileSync('git', ['--version'], { encoding: 'utf8' }).match(/(\d+)\.(\d+)/);
    return Number(v[1]) > 2 || (Number(v[1]) === 2 && Number(v[2]) >= 32);
  } catch { return false; }
})();
function withSystemConfig(text, fn) {
  const file = path.join(tmp, `sys-${Math.random().toString(36).slice(2)}.cfg`);
  fs.writeFileSync(file, text);
  const env = { ...process.env, GIT_CONFIG_SYSTEM: file };
  delete env.GIT_CONFIG_NOSYSTEM;
  F.resetSystemLineEndingPinsCache();
  try { return fn(env); } finally { F.resetSystemLineEndingPinsCache(); }
}

t.test('filterLineEndingPairs keeps allowlisted values only', () => {
  t.eq(F.filterLineEndingPairs({ 'core.autocrlf': 'true\n', 'core.eol': 'CRLF', 'core.safecrlf': 'warn' }),
    [['core.autocrlf', 'true'], ['core.eol', 'crlf'], ['core.safecrlf', 'warn']]);
  t.eq(F.filterLineEndingPairs({ 'core.autocrlf': 'yes', 'core.eol': 'x;rm', 'core.safecrlf': '' }), []);
  t.eq(F.filterLineEndingPairs({ 'core.safecrlf': 'input', 'core.autocrlf': 'input' }), [['core.autocrlf', 'input']]);
  t.eq(F.filterLineEndingPairs({}), []);
});

t.test('extraPins append after existing GIT_CONFIG_COUNT entries and reject multi-line values', () => {
  const base = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'x' };
  const add = H.hardenedGitConfigEnv({ baseEnv: base, extraPins: [['core.autocrlf', 'true']] });
  t.eq(Number(add.GIT_CONFIG_COUNT), 1 + 5 + 1);
  t.ok(!('GIT_CONFIG_KEY_0' in add));
  t.eq([add.GIT_CONFIG_KEY_6, add.GIT_CONFIG_VALUE_6], ['core.autocrlf', 'true']);
  t.assert.throws(() => H.hardenedGitConfigEnv({ extraPins: [['core.eol', 'lf\nx']] }));
});

t.test('system autocrlf/eol/safecrlf are forwarded into the agent env; other system keys are not', () => {
  if (!gitSupportsSystemVar) { console.log('       SKIP: git < 2.32'); return; }
  withSystemConfig('[core]\n\tautocrlf = true\n\teol = crlf\n\tsafecrlf = warn\n\tsshCommand = evil\n[user]\n\tname = sys\n', (env) => {
    const out = buildAgentChildEnv({ ...env, PATH: process.env.PATH }, {});
    t.eq(out.GIT_CONFIG_NOSYSTEM, '1');
    const e = Object.fromEntries(entries(out));
    t.eq([e['core.autocrlf'], e['core.eol'], e['core.safecrlf']], ['true', 'crlf', 'warn']);
    t.eq(e['core.sshCommand'], 'ssh');
    t.ok(!('user.name' in e));
  });
});

t.test('absent keys and invalid values are skipped', () => {
  if (!gitSupportsSystemVar) { console.log('       SKIP: git < 2.32'); return; }
  withSystemConfig('[core]\n\tautocrlf = bogus\n\teol = native\n', (env) => {
    t.eq(F.systemLineEndingPins(env), [['core.eol', 'native']]);
  });
  withSystemConfig('[user]\n\tname = sys\n', (env) => t.eq(F.systemLineEndingPins(env), []));
});

t.test('real git: agent env with forwarded autocrlf sees a CRLF checkout as clean', () => {
  if (!gitSupportsSystemVar) { console.log('       SKIP: git < 2.32'); return; }
  withSystemConfig('[core]\n\tautocrlf = true\n', (sysEnv) => {
    const repo = path.join(tmp, 'repo');
    const base = { ...sysEnv, GIT_CONFIG_GLOBAL: GIT_NULL_CONFIG };
    const g = (env, ...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', env }).trim();
    execFileSync('git', ['init', '-q', repo], { env: base });
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\r\ntwo\r\n');
    g(base, 'add', 'a.txt');
    g({ ...base, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@b', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@b' }, 'commit', '-q', '-m', 'x');
    fs.utimesSync(path.join(repo, 'a.txt'), new Date(), new Date(Date.now() + 5000));
    const agent = { ...buildAgentChildEnv({ ...sysEnv, PATH: process.env.PATH }, {}), GIT_CONFIG_GLOBAL: GIT_NULL_CONFIG };
    t.eq(g(agent, 'status', '--porcelain'), '');
    t.eq(g(base, 'status', '--porcelain'), '');
  });
});

t.done();
