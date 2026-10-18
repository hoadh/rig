'use strict';
/** Per-project clone resolution: registry `repos` map keyed by normalized origin -> one resolved `repo`. */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-repo-resolver-'));
process.env.RIG_MACHINES_FILE = path.join(dir, 'machines.json');
process.env.GIT_SSH_COMMAND = 'false'; // doctor's ls-remote of the fake origin fails fast, no network
const R = require('../lib/machine-repo-for-project-resolver.cjs');
const { workerTarget } = require('../lib/orchestrator-run-client.cjs');
const doctor = require('../commands/doctor-command.cjs');

const legacy = { name: 'old', ssh: 'rig@old', os: 'linux', shell: 'bash', repo: '/home/rig/x', pathPrepend: [] };
const multi = { ...legacy, name: 'box', repo: '/home/rig/a', repos: { 'github.com/o/a': '/home/rig/a', 'github.com/o/b': '/home/rig/b' } };

t.test('repos[key] wins, matched across ssh/https forms and credentials', () => {
  t.eq(R.resolveRepoForProject(multi, 'https://tok@GitHub.com/o/b.git').repo, '/home/rig/b');
  t.eq(R.resolveRepoForProject(multi, 'git@github.com:o/a.git').repo, '/home/rig/a');
  t.ok(!('repos' in R.resolveRepoForProject(multi, 'git@github.com:o/a.git')));
});
t.test('legacy entry or no origin -> repo', () => {
  t.eq(R.resolveRepoForProject(legacy, 'git@github.com:o/zzz.git').repo, '/home/rig/x');
  const r = R.resolveRepoForProject(multi, '');
  t.eq(r.repo, '/home/rig/a'); t.ok(!('repos' in r));
});
t.test('map present, project missing -> no-clone exit 2 with register hint (even though `repo` is unclaimed)', () => {
  const m = { ...multi, repo: '/home/rig/free', repos: { 'github.com/o/a': '/home/rig/a' } };
  const e = t.throwsRemote(() => R.resolveRepoForProject(m, 'git@github.com:o/c.git'), { exitCode: 2, cls: 'no-clone' });
  t.ok(e.message.includes('github.com/o/c') && e.hint.includes('register box --repo'), e.hint);
});
t.test('hasCloneForProject: true/false/null', () => {
  t.eq(R.hasCloneForProject(multi, 'git@github.com:o/b.git'), true);
  t.eq(R.hasCloneForProject(multi, 'git@github.com:o/c.git'), false);
  t.eq(R.hasCloneForProject(legacy, 'git@github.com:o/c.git'), true);
  t.eq(R.hasCloneForProject(multi, ''), null);
});

// a project repo with origin o/b to resolve from
const proj = path.join(dir, 'b');
fs.mkdirSync(proj);
spawnSync('git', ['init', '-q', proj]);
spawnSync('git', ['-C', proj, 'remote', 'add', 'origin', 'git@github.com:o/b.git']);
const { name: _a, ...multiEntry } = multi;
const { name: _b, ...legacyEntry } = legacy;
fs.writeFileSync(process.env.RIG_MACHINES_FILE, JSON.stringify({ machines: { box: multiEntry, old: legacyEntry,
  only: { ...multiEntry, repos: { 'github.com/o/a': '/home/rig/a' } } } }));
const cwd = process.cwd();
process.chdir(proj);

t.test('projectOriginUrl reads cwd origin; workerTarget sends a resolved target without repos', () => {
  t.eq(R.projectOriginUrl(proj), 'git@github.com:o/b.git');
  t.eq(R.projectOriginUrl(dir), '');
  const target = workerTarget('box');
  t.eq(target.repo, '/home/rig/b');
  t.ok(!('repos' in target) && !('name' in target), JSON.stringify(target));
  t.eq(workerTarget('old'), legacyEntry, 'legacy target byte-identical');
  t.throwsRemote(() => workerTarget('only'), { exitCode: 2, cls: 'no-clone' });
});
t.test('doctor: project without a clone -> repo fail with register fix, no ssh', async () => {
  let out = '';
  const write = process.stdout.write;
  process.stdout.write = (s) => { out += s; return true; };
  const client = { execWorker: async () => { throw new Error('no ssh expected'); }, workerTarget };
  let code;
  try { code = await doctor.run(['only', '--json'], { client }); } finally { process.stdout.write = write; }
  t.eq(code, 1);
  const c = JSON.parse(out).machines[0].checks;
  t.eq(c.length, 1); t.eq([c[0].id, c[0].status], ['repo', 'fail']);
  t.ok(c[0].fix.includes('register only --repo'), c[0].fix);
});

t.test('setup: project without a clone -> exit 2 no-clone before any ssh call', async () => {
  const setupCommand = require('../commands/setup-command.cjs');
  let sshCalls = 0;
  const client = { workerTarget, execWorker: async () => { sshCalls++; throw new Error('no ssh expected'); }, prepare: async () => { sshCalls++; throw new Error('no prepare expected'); } };
  // `only` has a repos map that does not list project b (origin o/b) -> strict no-clone
  await t.rejectsRemote(setupCommand.run(['only'], { client }), { exitCode: 2, cls: 'no-clone' });
  t.eq(sshCalls, 0);
});

process.on('exit', () => { process.chdir(cwd); fs.rmSync(dir, { recursive: true, force: true }); });
t.done();
