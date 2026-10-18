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
/** A git repo (temp dir) whose origin is `url` ('' = no origin) to run the CLI in. */
const project = (name, url) => {
  const p = path.join(dir, name);
  fs.mkdirSync(p);
  spawnSync('git', ['init', '-q', p]);
  if (url) spawnSync('git', ['-C', p, 'remote', 'add', 'origin', url]);
  return p;
};
const projA = project('a', 'git@github.com:o/a.git');
const projB = project('b', 'https://github.com/o/b.git');
const projC = project('c', 'git@github.com:o/c.git');
const noOrigin = project('none', '');
const cli = (args, registry = file, cwd = projA) => spawnSync(process.execPath, [CLI, 'machines', ...args], {
  cwd, encoding: 'utf8', env: { ...process.env, RIG_MACHINES_FILE: registry, RIG_MACHINE: 'studio' },
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
  t.eq(out.machines[1], { id: 'win11', os: 'windows', shell: 'powershell', allowedTools: ['Bash(npm test:*)'], hasClone: true });
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

t.test('hasClone per project: legacy entry true, repos map true/false, no origin null; paths never printed', () => {
  const multi = path.join(dir, 'multi.json');
  fs.writeFileSync(multi, JSON.stringify({ machines: {
    box: { ssh: 'rig@box', os: 'linux', shell: 'bash', repo: '/home/rig/a', pathPrepend: [], repos: { 'github.com/o/a': '/home/rig/a', 'github.com/o/b': '/home/rig/b' } },
    old: { ssh: 'rig@old', os: 'linux', shell: 'bash', repo: '/home/rig/x', pathPrepend: [] },
  } }));
  const has = (cwd) => JSON.parse(cli(['--json'], multi, cwd).stdout).machines.map((m) => m.hasClone);
  t.eq(has(projA), [true, true]);
  t.eq(has(projB), [true, true]);
  t.eq(has(projC), [false, true]);
  t.eq(has(noOrigin), [null, null]);
  const r = cli([], multi, projC);
  t.ok(r.stdout.includes('box  linux/bash (no clone for this project)') && !r.stdout.includes('/home/rig'), r.stdout);
});
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
t.done();
