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
/** A git repo (temp dir) whose origin is `url` ('' = no origin) to run the CLI in. */
const project = (name, url) => {
  const p = path.join(dir, name);
  fs.mkdirSync(p);
  spawnSync('git', ['init', '-q', p]);
  if (url) spawnSync('git', ['-C', p, 'remote', 'add', 'origin', url]);
  return p;
};
const noOrigin = project('none', '');
const projA = project('a', 'git@github.com:o/a.git');
const projB = project('b', 'https://tok@github.com/o/b.git');
const cli = (args, registry = file, cwd = noOrigin) => spawnSync(process.execPath, [CLI, 'register', ...args], {
  cwd, encoding: 'utf8', env: { ...process.env, RIG_MACHINES_FILE: registry, RIG_MACHINE: 'studio' },
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

t.test('projects: new id records repos[origin]; other project adds its clone with just --repo', () => {
  const f = path.join(dir, 'multi.json');
  const r1 = cli(['box', '--ssh', 'rig@box', '--os', 'linux', '--repo', '/home/rig/a'], f, projA);
  t.eq(r1.status, 0, r1.stderr);
  t.eq(read(f).box.repos, { 'github.com/o/a': '/home/rig/a' });
  const r2 = cli(['box', '--repo', '/home/rig/b'], f, projB);
  t.eq(r2.status, 0, r2.stderr);
  t.ok(r2.stdout.includes('added project github.com/o/b -> /home/rig/b to box') && !r2.stdout.includes('warning'), r2.stdout);
  t.eq(read(f).box.repos, { 'github.com/o/a': '/home/rig/a', 'github.com/o/b': '/home/rig/b' });
  t.ok(!fs.readFileSync(f, 'utf8').includes('tok'), 'origin creds never written');
  t.eq(read(f).box.repo, '/home/rig/a', 'default repo unchanged');
  const r3 = cli(['box', '--repo', '/home/rig/b2', '--os', 'linux', '--ssh', 'rig@box'], f, projB);
  t.eq(r3.status, 0, r3.stderr); t.ok(r3.stdout.includes('updated project'), r3.stdout);
});
t.test('projects: conflicting flag refused, colliding path refused, no origin refused, --replace keeps other projects', () => {
  const f = path.join(dir, 'multi.json');
  const before = fs.readFileSync(f, 'utf8');
  const diff = cli(['box', '--repo', '/home/rig/b', '--ssh', 'rig@other'], f, projB);
  t.eq(diff.status, 2); t.ok(diff.stderr.includes('different ssh') && diff.stderr.includes('--replace'), diff.stderr);
  t.eq(cli(['box', '--repo', '/home/rig/a-rig-test'], f, projB).status, 2, '-rig-test collision');
  t.eq(cli(['box', '--repo', '/home/rig/a/sub'], f, projB).status, 2, 'nested');
  const none = cli(['box', '--repo', '/home/rig/z'], f, noOrigin);
  t.eq(none.status, 2); t.ok(none.stderr.includes('origin'), none.stderr);
  t.eq(fs.readFileSync(f, 'utf8'), before);
  t.eq(cli(['box', '--ssh', 'rig@box2', '--os', 'linux', '--repo', '/home/rig/a3', '--replace'], f, projA).status, 0);
  t.eq(read(f).box, { ssh: 'rig@box2', os: 'linux', shell: 'bash', repo: '/home/rig/a3', pathPrepend: [],
    repos: { 'github.com/o/a': '/home/rig/a3', 'github.com/o/b': '/home/rig/b2' } });
});
t.test('projects: first repos key on a legacy entry warns about other projects', () => {
  const f = path.join(dir, 'legacy.json');
  fs.writeFileSync(f, JSON.stringify({ machines: { old: { ssh: 'rig@old', os: 'linux', shell: 'bash', repo: '/home/rig/x', pathPrepend: [] } } }));
  const r = cli(['old', '--repo', '/home/rig/b'], f, projB);
  t.eq(r.status, 0, r.stderr);
  t.ok(r.stdout.includes('warning: other projects using /home/rig/x on old must now run `remote.cjs register old --repo /home/rig/x`'), r.stdout);
  t.eq(read(f).old.repos, { 'github.com/o/b': '/home/rig/b' });
});
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
t.done();
