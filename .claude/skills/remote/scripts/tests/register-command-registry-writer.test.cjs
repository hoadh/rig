'use strict';
/** `remote.cjs register`: validated, atomic single-entry writes to the machine registry. */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');

const CLI = path.join(__dirname, '..', 'remote.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-register-'));
const file = path.join(dir, 'sub', 'machines.json');
const cli = (args, registry = file) => spawnSync(process.execPath, [CLI, 'register', ...args], {
  encoding: 'utf8', env: { ...process.env, RIG_MACHINES_FILE: registry, RIG_MACHINE: 'studio' },
});
const read = (f = file) => JSON.parse(fs.readFileSync(f, 'utf8')).machines;
const BOX = ['box', '--ssh', 'rig@box', '--os', 'linux', '--repo', '/home/rig/app'];

t.test('creates the registry (and its dir) with bash default + empty pathPrepend', () => {
  const r = cli(BOX);
  t.eq(r.status, 0, r.stderr);
  t.ok(r.stdout.includes('added box') && r.stdout.includes('(new file)'), r.stdout);
  t.eq(read().box, { ssh: 'rig@box', os: 'linux', shell: 'bash', repo: '/home/rig/app', pathPrepend: [] });
});
t.test('windows entry: powershell default, ;-separated pathPrepend, tools with spaces, node kept', () => {
  const r = cli(['win11', '--ssh', 'rig@win11', '--os', 'windows', '--repo', 'C:\\rig\\app', '--node', 'C:\\Program Files\\nodejs\\node.exe',
    '--path-prepend', 'C:\\Program Files\\nodejs; C:\\tools', '--allowed-tools', 'Bash(npm test:*) Bash(npm run lint:*)', '--task-mode', 'headless']);
  t.eq(r.status, 0, r.stderr);
  t.eq(read().win11, { ssh: 'rig@win11', os: 'windows', shell: 'powershell', repo: 'C:\\rig\\app', pathPrepend: ['C:\\Program Files\\nodejs', 'C:\\tools'],
    node: 'C:\\Program Files\\nodejs\\node.exe', allowedTools: ['Bash(npm test:*)', 'Bash(npm run lint:*)'], taskMode: 'headless' });
  t.eq(Object.keys(read()), ['box', 'win11'], 'existing entry kept');
});
t.test('duplicate id refused without --replace; --replace overwrites', () => {
  const dup = cli([...BOX.slice(0, 6), '/home/rig/other']);
  t.eq(dup.status, 2);
  t.ok(dup.stderr.includes('--replace'), dup.stderr);
  t.eq(read().box.repo, '/home/rig/app');
  t.eq(cli([...BOX.slice(0, 6), '/home/rig/other', '--replace']).status, 0);
  t.eq(read().box.repo, '/home/rig/other');
});
t.test('rejects unsafe or invalid entries without touching the file', () => {
  const before = fs.readFileSync(file, 'utf8');
  t.eq(cli(['w2', '--ssh', 'rig@w2', '--os', 'windows', '--repo', 'C:\\rig\\app']).status, 2, 'windows needs node');
  t.eq(cli(['b2', '--ssh', 'rig@b2', '--os', 'linux', '--repo', '/x', '--allowed-tools', 'Bash']).status, 2, 'bare Bash');
  t.eq(cli(['b3', '--ssh', 'rig@b3', '--os', 'linux', '--repo', '/x', '--allowed-tools', 'Bash(curl:*)']).status, 2, 'curl');
  t.eq(cli(['B_4', '--ssh', 'rig@b4', '--os', 'linux', '--repo', '/x']).status, 2, 'bad id');
  t.eq(cli(['b5', '--ssh', '-oProxyCommand=x', '--os', 'linux', '--repo', '/x']).status, 2, 'option-like ssh');
  t.eq(cli(['b6', '--os', 'linux', '--repo', '/x']).status, 2, 'missing --ssh');
  t.eq(fs.readFileSync(file, 'utf8'), before);
});
t.test('an invalid existing registry is never rewritten', () => {
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, '{"machines":{"x":{"ssh":"a@b","os":"linux","shell":"bash","repo":"/r","pathPrepend":[],"token":"t"}}}');
  const r = cli(BOX, bad);
  t.eq(r.status, 2);
  t.ok(r.stderr.includes('secret'), r.stderr);
  t.ok(fs.readFileSync(bad, 'utf8').includes('"token"'));
});

process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
t.done();
