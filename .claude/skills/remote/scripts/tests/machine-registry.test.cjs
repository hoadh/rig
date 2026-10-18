'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const reg = require('../lib/machine-registry.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-registry-test-'));
const file = path.join(dir, 'machines.json');
process.env.RIG_MACHINES_FILE = file; // never touch the real ~/.claude/rig-machines.json
const write = (machines) => fs.writeFileSync(file, JSON.stringify({ machines }));

const linux = { ssh: 'ubuntu@laco', os: 'linux', shell: 'bash', repo: '/home/ubuntu/rig/x', pathPrepend: [] };
const win = { ssh: 'dev@waso', os: 'windows', shell: 'cmd', repo: 'C:\\rig\\x', pathPrepend: ['C:\\Users\\dev\\.cargo\\bin'], node: 'C:\\Program Files\\nodejs\\node.exe' };
const bad = (entry, re) => {
  write({ m: entry });
  const e = t.throwsRemote(() => reg.loadRegistry(), { exitCode: 2 });
  t.ok(re.test(e.message), `message ${e.message} should match ${re}`);
};

t.test('loads valid registry + getMachine', () => {
  write({ laco: linux, waso: { ...win, taskMode: 'headless', allowedTools: ['Bash(cargo test:*)'] } });
  const r = reg.loadRegistry();
  t.eq(Object.keys(r.machines), ['laco', 'waso']);
  t.eq(reg.getMachine('waso').taskMode, 'headless');
});
t.test('powershell shell accepted on windows', () => {
  write({ w: { ...win, shell: 'powershell' } });
  t.eq(reg.getMachine('w').shell, 'powershell');
});
t.test('missing file -> exit 2 registry-missing', () => {
  process.env.RIG_MACHINES_FILE = path.join(dir, 'nope.json');
  t.throwsRemote(() => reg.loadRegistry(), { exitCode: 2, cls: 'registry-missing' });
  process.env.RIG_MACHINES_FILE = file;
});
t.test('invalid JSON / bad shape', () => {
  fs.writeFileSync(file, '{nope');
  t.throwsRemote(() => reg.loadRegistry(), { exitCode: 2 });
  fs.writeFileSync(file, JSON.stringify({ machines: {}, extra: 1 }));
  t.throwsRemote(() => reg.loadRegistry(), { exitCode: 2 });
});
t.test('unknown keys rejected, secrets called out', () => {
  bad({ ...linux, sshh: 'x' }, /unknown key "sshh"/);
  bad({ ...linux, apiToken: 'x' }, /looks like a secret/);
});
t.test('required keys', () => {
  for (const k of ['ssh', 'os', 'shell', 'repo', 'pathPrepend']) {
    const e = { ...linux }; delete e[k];
    bad(e, new RegExp(`missing required key "${k}"`));
  }
});
t.test('windows requires node; other OS optional', () => {
  const w = { ...win }; delete w.node;
  bad(w, /"node".*required/);
  write({ l: { ...linux, node: '/home/ubuntu/.nvm/versions/node/v24.14.0/bin/node' } });
  t.ok(reg.getMachine('l').node);
});
t.test('taskMode only on windows, valid values', () => {
  bad({ ...linux, taskMode: 'headless' }, /taskMode is only valid/);
  bad({ ...win, taskMode: 'fast' }, /taskMode must be one of/);
});
t.test('injection in ssh / paths rejected', () => {
  bad({ ...linux, ssh: '-oProxyCommand=x' }, /invalid/);
  bad({ ...linux, ssh: 'a@-o' }, /invalid/);
  bad({ ...win, repo: 'C:\\a b' }, /whitespace/);
  bad({ ...win, pathPrepend: ['C:\\a%b'] }, /forbidden/);
  bad({ ...linux, repo: 'relative/path' }, /absolute/);
  bad({ ...linux, shell: 'cmd' }, /only valid for os=windows/);
  bad({ ...linux, pathPrepend: 'x' }, /array/);
  bad({ ...linux, allowedTools: [1] }, /allowedTools/);
});
t.test('unknown machine -> exit 2 listing known', () => {
  write({ laco: linux });
  const e = t.throwsRemote(() => reg.getMachine('zzz'), { exitCode: 2 });
  t.ok(e.hint.includes('laco'));
  t.throwsRemote(() => reg.getMachine('Bad Name'), { exitCode: 2 });
});
t.test('selfMachineId: env wins, else lowercase hostname without domain', () => {
  process.env.RIG_MACHINE = 'MyBox';
  t.eq(reg.selfMachineId(), 'mybox');
  delete process.env.RIG_MACHINE;
  t.eq(reg.selfMachineId(), os.hostname().split('.')[0].toLowerCase());
});

t.test('windows pathPrepend may contain spaces (env-only) but not PATH delimiter or cmd metachars', () => {
  write({ w: { ...win, pathPrepend: ['C:\\Program Files\\nodejs'] } });
  t.eq(reg.loadRegistry().machines.w.pathPrepend, ['C:\\Program Files\\nodejs']);
  bad({ ...win, pathPrepend: ['C:\\a;C:\\b'] }, /pathPrepend\[0\].*forbidden/);
  bad({ ...win, pathPrepend: ['C:\\a&b'] }, /pathPrepend\[0\]/);
  bad({ ...win, pathPrepend: ['C:\\a\tb'] }, /pathPrepend\[0\]/);
});

t.test('repos map: valid keys/paths load; creds, non-normalized, dup, nested, -rig-test, windows case rejected', () => {
  write({ m: { ...linux, repos: { 'github.com/o/a': '/home/ubuntu/rig/x', 'github.com/o/b': '/home/ubuntu/b' } } });
  t.eq(reg.getMachine('m').repos['github.com/o/b'], '/home/ubuntu/b');
  bad({ ...linux, repos: [] }, /repos must be an object/);
  bad({ ...linux, repos: { 'u:tok@github.com/o/a': '/a' } }, /not a normalized origin/);
  bad({ ...linux, repos: { 'git@github.com:o/a.git': '/a' } }, /not a normalized origin/);
  bad({ ...linux, repos: { 'GitHub.com/o/a': '/a' } }, /not a normalized origin/);
  bad({ ...linux, repos: { 'github.com/o/a': 'rel/path' } }, /absolute/);
  bad({ ...linux, repos: { 'github.com/o/a': '/a', 'github.com/o/b': '/a/' } }, /share the clone path/);
  bad({ ...linux, repos: { 'github.com/o/a': '/home/ubuntu/rig/x/inner' } }, /nested/);
  bad({ ...linux, repos: { 'github.com/o/a': '/home/ubuntu/rig/x-rig-test' } }, /test clone/);
  bad({ ...win, repos: { 'github.com/o/a': 'C:\\RIG\\X-rig-test' } }, /test clone/);
  bad({ ...win, repos: { 'github.com/o/a': 'c:/rig/a', 'github.com/o/b': 'C:\\Rig\\A' } }, /share the clone path/);
});

t.test('repos map: empty map, key without path, clone inside another test clone rejected', () => {
  bad({ ...linux, repos: {} }, /repos is empty/);
  bad({ ...linux, repos: { __proto__x: '/a' } }, /not a normalized origin/);
  bad({ ...linux, repos: { 'github.com/o/a': '/home/ubuntu/rig/x-rig-test/q' } }, /test clone/);
});

t.done().finally(() => fs.rmSync(dir, { recursive: true, force: true }));
