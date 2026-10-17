'use strict';
/** `remote.cjs machines`: local registry listing for /rig:plan (no ssh, no paths/ssh targets in output). */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');

const CLI = path.join(__dirname, '..', 'remote.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-machines-cmd-'));
const file = path.join(dir, 'machines.json');
const cli = (args, registry = file) => spawnSync(process.execPath, [CLI, 'machines', ...args], {
  encoding: 'utf8', env: { ...process.env, RIG_MACHINES_FILE: registry, RIG_MACHINE: 'studio' },
});

fs.writeFileSync(file, JSON.stringify({ machines: {
  studio: { ssh: 'rig@studio.local', os: 'macos', shell: 'bash', repo: '/Users/rig/app', pathPrepend: [] },
  win11: { ssh: 'rig@win11', os: 'windows', shell: 'powershell', repo: 'C:\\rig\\app', pathPrepend: [],
    node: 'C:\\Program Files\\nodejs\\node.exe', allowedTools: ['Bash(npm test:*)'] },
} }));

t.test('--json lists self + machines, dropping ssh targets and repo paths', () => {
  const r = cli(['--json']);
  t.eq(r.status, 0);
  const out = JSON.parse(r.stdout);
  t.eq(out.self, 'studio');
  t.eq(out.found, true);
  t.eq(out.machines[0].allowedTools, []);
  t.eq(out.machines.map((m) => m.id), ['studio', 'win11']);
  t.eq(out.machines[1], { id: 'win11', os: 'windows', shell: 'powershell', allowedTools: ['Bash(npm test:*)'] });
  t.ok(!r.stdout.includes('rig@') && !r.stdout.includes('C:\\\\rig'), 'no ssh target / repo path');
});
t.test('text output marks this machine', () => {
  const r = cli([]);
  t.eq(r.status, 0);
  t.ok(/studio \(this machine\)\s+macos\/bash/.test(r.stdout), r.stdout);
  t.ok(r.stdout.includes('win11  windows/powershell tools: Bash(npm test:*)'), r.stdout);
});
t.test('missing registry -> found false with searched path, exit 0', () => {
  const nope = path.join(dir, 'nope.json');
  const r = cli(['--json'], nope);
  t.eq(r.status, 0);
  t.eq(JSON.parse(r.stdout), { self: 'studio', registry: nope, found: false, machines: [] });
  t.ok(cli([], nope).stdout.includes(`registry: (none at ${nope})`));
});
t.test('empty machines map -> found true, no machines', () => {
  const empty = path.join(dir, 'empty.json');
  fs.writeFileSync(empty, JSON.stringify({ machines: {} }));
  const out = JSON.parse(cli(['--json'], empty).stdout);
  t.eq([out.found, out.machines], [true, []]);
});
t.test('invalid registry -> exit 2; extra positional -> exit 2', () => {
  const badFile = path.join(dir, 'bad.json');
  fs.writeFileSync(badFile, '{nope');
  t.eq(cli([], badFile).status, 2);
  t.eq(cli(['win11']).status, 2);
});

process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
t.done();
