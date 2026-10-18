'use strict';
const t = require('./minimal-test-harness.cjs');
const { buildChildEnv } = require('../lib/child-process-env-allowlist.cjs');

const parent = {
  PATH: '/usr/bin', HOME: '/home/u', USER: 'u', LANG: 'en_US.UTF-8', LC_ALL: 'C', TERM: 'xterm',
  CLAUDE_CODE_OAUTH_TOKEN: 'tok', CLAUDE_CONFIG_DIR: '/c', https_proxy: 'http://p', no_proxy: 'x',
  SSH_AUTH_SOCK: '/s', GH_TOKEN: 'g', GITHUB_TOKEN: 'g2', AWS_SECRET_ACCESS_KEY: 'a', NPM_TOKEN: 'n',
  GIT_DIR: '/x', GIT_ASKPASS: 'y', RIG_HOME: '/h',
};

t.test('keeps allowlisted names incl. LC_* and Claude auth', () => {
  const e = buildChildEnv(parent, { platform: 'linux' });
  for (const k of ['HOME', 'USER', 'LANG', 'LC_ALL', 'TERM', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'https_proxy', 'no_proxy']) t.ok(k in e, k);
});

t.test('drops tokens, ssh agent, GIT_*, AWS_*, RIG_*', () => {
  const e = buildChildEnv(parent, { platform: 'linux' });
  for (const k of ['SSH_AUTH_SOCK', 'GH_TOKEN', 'GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'NPM_TOKEN', 'GIT_DIR', 'GIT_ASKPASS', 'RIG_HOME']) t.ok(!(k in e), k);
});

t.test('PATH = pathPrepend first, then inherited', () => {
  t.eq(buildChildEnv(parent, { platform: 'linux', pathPrepend: ['/a', '/b'] }).PATH, '/a:/b:/usr/bin');
  t.eq(buildChildEnv({}, { platform: 'linux', pathPrepend: ['/a'] }).PATH, '/a');
});

t.test('windows: case-insensitive names, ; delimiter, Path key', () => {
  const e = buildChildEnv({ Path: 'C:\\Windows', SystemRoot: 'C:\\Windows', userprofile: 'C:\\u', GH_TOKEN: 'x', comspec: 'cmd' }, { platform: 'win32', pathPrepend: ['C:\\node'] });
  t.eq(e.Path, 'C:\\node;C:\\Windows');
  t.ok(e.SystemRoot && e.userprofile && e.comspec);
  t.ok(!('GH_TOKEN' in e));
});

t.test('windows: keeps system folder vars that dotnet/NuGet need', () => {
  const e = buildChildEnv({ ProgramFiles: 'C:\\PF', 'ProgramFiles(x86)': 'C:\\PF86', PROGRAMDATA: 'C:\\PD', SystemDrive: 'C:', windir: 'C:\\Windows' }, { platform: 'win32' });
  for (const k of ['ProgramFiles', 'ProgramFiles(x86)', 'PROGRAMDATA', 'SystemDrive', 'windir']) t.ok(k in e, k);
});

t.done();
