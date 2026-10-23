'use strict';
/** dispatch + collect + plan status end to end with an injected fake worker client (no ssh). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const { makeRepoWithBareRemote } = require('./temp-git-repo-with-bare-remote.cjs');

const SLUG = 'plan-x';
const out = [];
const realWrite = process.stdout.write.bind(process.stdout);
const capture = async (fn) => { process.stdout.write = (s) => { out.push(String(s)); return true; }; try { return await fn(); } finally { process.stdout.write = realWrite; } };

function setup() {
  const env = makeRepoWithBareRemote({ clones: ['main'] });
  const repo = env.clone('main');
  env.git(repo, 'push', '-q', 'origin', 'main');
  const reg = path.join(env.root, 'machines.json');
  fs.writeFileSync(reg, JSON.stringify({ machines: { waso: { ssh: 'u@waso', os: 'linux', shell: 'bash', repo: '/home/u/rig', pathPrepend: [], allowedTools: ['Bash(npm test:*)'] } } }));
  Object.assign(process.env, { RIG_MACHINES_FILE: reg, RIG_MACHINE: 'mac' });
  const plan = path.join(env.root, 'plans', SLUG);
  fs.mkdirSync(plan, { recursive: true });
  fs.writeFileSync(path.join(plan, 'plan.md'), `---\ntitle: x\nbranch: main\n---\n| Phase | Name | Status |\n|---|---|---|\n| 1 | [Build](./phase-01-build.md) | Pending |\n`);
  fs.writeFileSync(path.join(plan, 'phase-01-build.md'), '---\nmachine: waso\nowns: [src/**]\n---\n# Build\nDo it.\n');
  process.chdir(repo);
  return { env, repo, plan };
}
const fakeClient = (runs = [], extra = {}) => {
  const c = { started: [], runs, ...extra };
  c.fetchRunList = async () => c.runs;
  c.fetchRunStatus = async (m, id) => ({ runId: id, state: 'done', exit: 0, logTail: 'ok', result: { claude: { session_id: 'S', result: 'fine' } } });
  c.startRun = async (m, spec, task) => { c.started.push({ m, spec, task }); return { runId: spec.runId, state: 'starting', method: 'fake' }; };
  c.waitForRun = async () => ({ state: 'done', exit: 0, logTail: 'tests passed' });
  return c;
};
const ctxOf = (client) => ({ self: 'mac', client, ensureCompatible: async () => ({}) });

t.test('dispatch starts agent run with owns, tools, immutable base; marks phase In Progress', async () => {
  const { env, repo, plan } = setup();
  try {
    const client = fakeClient();
    const code = await capture(() => require('../commands/dispatch-command.cjs').run([plan, 'phase-01-build.md'], ctxOf(client)));
    t.eq(code, 0);
    const { spec, task } = client.started[0];
    t.eq([spec.kind, spec.owns, spec.baseSha, spec.branch], ['agent', ['src/**'], env.git(repo, 'rev-parse', 'HEAD'), `rig/waso/${SLUG}`]);
    t.ok(spec.agent.allowedTools.includes('Bash(npm test:*)') && !spec.agent.allowedTools.includes('Bash'));
    t.ok(task.includes('Do it.'));
    t.ok(/In Progress/.test(fs.readFileSync(path.join(plan, 'plan.md'), 'utf8')));
    // second dispatch refused while an agent run is active
    const busy = fakeClient([{ runId: 'r-1', kind: 'agent', state: 'running', phase: '01' }]);
    const e = await t.rejectsRemote((() => require('../commands/dispatch-command.cjs').run([plan, 'phase-01-build.md'], ctxOf(busy)))(), { exitCode: 1, cls: 'agent-active' });
    t.ok(e);
  } finally { process.chdir(os.tmpdir()); env.cleanup(); }
});

t.test('dispatch refuses unpushed plan branch and own-machine phase', async () => {
  const { env, repo, plan } = setup();
  try {
    env.commitFile('main', 'local.txt', 'x');
    await t.rejectsRemote((() => require('../commands/dispatch-command.cjs').run([plan, 'phase-01-build.md'], ctxOf(fakeClient())))(), { exitCode: 1, cls: 'push-first' });
    await t.rejectsRemote((() => require('../commands/dispatch-command.cjs').run([plan, 'phase-01-build.md'], { ...ctxOf(fakeClient()), self: 'waso' }))(), { exitCode: 2 });
  } finally { process.chdir(os.tmpdir()); env.cleanup(); }
});

t.test('collect: unreviewed refused, reviewed merges + tests, report written', async () => {
  const { env, repo, plan } = setup();
  try {
    const collect = require('../commands/collect-command.cjs');
    const base = env.git(repo, 'rev-parse', 'HEAD');
    env.git(repo, 'checkout', '-q', '-B', `rig/waso/${SLUG}`, base);
    const head = env.commitFile('main', 'src/x.txt', '1\n');
    env.git(repo, 'push', '-q', 'origin', `rig/waso/${SLUG}`);
    env.git(repo, 'checkout', '-q', 'main');
    const client = fakeClient();
    await t.rejectsRemote((() => collect.run([plan], ctxOf(client)))(), { exitCode: 1, cls: 'unreviewed-commits' });
    const pf = path.join(plan, 'phase-01-build.md');
    fs.writeFileSync(pf, fs.readFileSync(pf, 'utf8').replace('owns:', `reviewedSha: ${head}\nowns:`));
    const code = await capture(() => collect.run([plan, '--test', 'waso=npm test'], ctxOf(client)));
    t.eq(code, 0);
    t.eq(client.started[0].spec.kind, 'command');
    t.eq(env.git(repo, 'ls-remote', 'origin', `refs/heads/rig-int/${SLUG}`).split(/\s+/)[0], client.started[0].spec.ref);
    t.ok(fs.readdirSync(path.join(plan, 'reports')).some((f) => f.startsWith('collect-')));
    await t.rejectsRemote((() => collect.run([plan], ctxOf(fakeClient([{ runId: 'r-2', kind: 'agent', state: 'running', phase: '01' }]))))(), { exitCode: 1, cls: 'runs-active' });
  } finally { process.chdir(os.tmpdir()); env.cleanup(); }
});

t.test('plan status: reads runs, writes report for finished run, exit 1 on failure', async () => {
  const { env, plan } = setup();
  try {
    const s = require('../commands/status-command.cjs');
    const done = fakeClient([{ runId: 'r-0000001', kind: 'agent', state: 'done', phase: '01', exit: 0 }]);
    // coord must be claimed first (status is read-only): dispatch does it
    await capture(() => require('../commands/dispatch-command.cjs').run([plan, 'phase-01-build.md'], ctxOf(fakeClient())));
    t.eq(await capture(() => s.run([plan], { self: 'mac', client: done })), 0);
    t.ok(fs.existsSync(path.join(plan, 'reports', 'remote-r-0000001.md')));
    const failed = fakeClient([{ runId: 'r-0000002', kind: 'agent', state: 'failed', phase: '01' }]);
    t.eq(await capture(() => s.run([plan, '--json'], { self: 'mac', client: failed })), 1);
  } finally { process.chdir(os.tmpdir()); env.cleanup(); }
});

t.test('dispatch --resume skips a newer session-less run (not-started) and resumes the earlier session', async () => {
  const { env, plan } = setup();
  try {
    const msg = path.join(env.root, 'fix.md');
    fs.writeFileSync(msg, 'Fix the review findings.');
    const status = { 'r-1': { claude: { session_id: 'S-EARLY' } }, 'r-2': {} };
    const runs = [{ runId: 'r-1', kind: 'agent', state: 'done', phase: '01' }, { runId: 'r-2', kind: 'agent', state: 'failed', failure: 'not-started', phase: '01' }];
    const client = fakeClient(runs, {});
    client.fetchRunStatus = async (m, id) => ({ runId: id, state: 'done', result: status[id] });
    t.eq(await capture(() => require('../commands/dispatch-command.cjs').run([plan, 'phase-01-build.md', '--resume', '--message-file', msg], ctxOf(client))), 0);
    const { spec, task } = client.started[0];
    t.eq([spec.agent.sessionId, spec.agent.resume, task], ['S-EARLY', true, 'Fix the review findings.']);
    // no run with a session at all -> no-session refusal
    const none = fakeClient([runs[1]]);
    none.fetchRunStatus = async (m, id) => ({ runId: id, state: 'failed', result: {} });
    await t.rejectsRemote((() => require('../commands/dispatch-command.cjs').run([plan, 'phase-01-build.md', '--resume', '--message-file', msg], ctxOf(none)))(), { exitCode: 1, cls: 'no-session' });
  } finally { process.chdir(os.tmpdir()); env.cleanup(); }
});
t.done();
