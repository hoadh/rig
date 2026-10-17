'use strict';
/**
 * Lifecycle fixes from review round 1: H4 (missing run.json wedge + sweep), H2 (git timeout,
 * heartbeat/ownership watchdog), H3 (agent tree killed on cancel / runner signal), M6 (not-started
 * finalize + grace vs Windows task window), M7 (dirty dedicated clone reset), env.json cleanup.
 */
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const { setup } = require('./worker-run-flow-fixture.cjs');
const R = require('../lib/run-directory.cjs');
const { intakeRun } = require('../lib/worker-run-intake.cjs');
const { runRun, finalizeAgentRun } = require('../worker-run-entry.cjs');
const { sweepOrphanRunDirs, ORPHAN_DIR_MIN_AGE_MS } = require('../lib/run-force-finalizer.cjs');
const { tick } = require('../lib/runner-heartbeat-thread.cjs');
const { recordAgentPid } = require('../lib/agent-process-registry.cjs');
const { prepareAgentClone } = require('../lib/worker-repo-preparer.cjs');
const { safeGit, gitTimeoutMs } = require('../lib/safe-git-runner.cjs');
const { pushWithRetry } = require('../lib/worker-branch-pusher.cjs');
const W = require('../lib/windows-scheduled-task-xml.cjs');
const cancelCmd = require('../worker-commands/cancel-command.cjs');
const statusCmd = require('../worker-commands/status-command.cjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const age = (p, ms) => { const s = (Date.now() - ms) / 1000; fs.utimesSync(p, s, s); };
async function until(fn, ms = 15000) { for (let i = 0; i < ms / 100; i++) { if (fn()) return true; await sleep(100); } return false; }
async function scenario(fn) { const f = setup(); try { await fn(f); } finally { f.cleanup(); } }
const reply = () => { const c = { out: null, reply: (o) => { c.out = o; } }; return c; };
const OTHER = 'r260101000009-zzzzzz';

t.test('H4: run dir without run.json is starting only while young, then failed:not-started (also when gone)', () => scenario(async () => {
  const dir = path.join(R.runsRoot(), 'r260101000000-aaaaaa');
  fs.mkdirSync(dir, { recursive: true });
  t.eq(R.readRunState(dir).state, 'starting');
  age(dir, R.STARTING_GRACE_MS + 1000);
  const st = R.readRunState(dir);
  t.eq([st.state, st.failure], ['failed', 'not-started']);
  t.eq(R.readRunState(path.join(R.runsRoot(), 'r260101000000-gone00')).failure, 'not-started');
}));

t.test('H4: sweep removes old run.json-less dirs, frees the busy marker they hold, spares young ones; intake sweeps', () => scenario(async (f) => {
  const old = 'r260101000001-bbbbbb', young = 'r260101000002-cccccc';
  for (const id of [old, young]) fs.mkdirSync(path.join(R.runsRoot(), id), { recursive: true });
  age(path.join(R.runsRoot(), old), ORPHAN_DIR_MIN_AGE_MS + 5000);
  t.eq(R.acquireBusy('agent', old).ok, true);
  intakeRun({ spec: f.agentSpec(), target: f.target, task: 'x' }); // would be 'busy' without the sweep/reclaim
  t.ok(!fs.existsSync(path.join(R.runsRoot(), old)));
  t.ok(fs.existsSync(path.join(R.runsRoot(), young)));
  t.eq(sweepOrphanRunDirs(Date.now() + 10 * ORPHAN_DIR_MIN_AGE_MS), [young]);
}));

t.test('M6: grace exceeds the Windows task window (start delay + EndBoundary)', () => {
  t.ok(R.STARTING_GRACE_MS > W.START_DELAY_MS + W.WINDOW_MS);
});

t.test('M6 + env.json: status of a never-started run writes exit, frees busy, deletes env.json; a late runner refuses to run', () => scenario(async (f) => {
  const { dir, run } = intakeRun({ spec: f.agentSpec(), target: f.target, task: 'x' });
  fs.writeFileSync(path.join(dir, 'env.json'), '{}');
  run.createdAt = Date.now() - R.STARTING_GRACE_MS - 1000;
  R.writeJsonAtomic(path.join(dir, 'run.json'), run);
  const c = reply();
  await statusCmd.run([run.spec.runId], c);
  t.eq([c.out.state, c.out.failure], ['failed', 'not-started']);
  t.eq(R.readJson(path.join(dir, 'exit')).failure, 'not-started');
  t.ok(!fs.existsSync(path.join(dir, 'env.json')));
  t.eq(R.acquireBusy('agent', 'probe').ok, true); R.releaseBusy('agent', 'probe');
  await runRun(dir); // exit exists -> must not run
  t.ok(!fs.existsSync(path.join(dir, 'heartbeat')));
}));

t.test('M6: runner that no longer holds the busy marker at start does not run and leaves the other holder alone', () => scenario(async (f) => {
  const { dir } = intakeRun({ spec: f.agentSpec(), target: f.target, task: 'x' });
  fs.writeFileSync(R.busyFile('agent'), OTHER);
  await runRun(dir);
  t.eq(R.readJson(path.join(dir, 'exit')).failure, 'lock');
  t.ok(!fs.existsSync(path.join(dir, 'agent.pid')));
  t.eq(fs.readFileSync(R.busyFile('agent'), 'utf8'), OTHER);
}));

t.test('H3: cancel of a lost run SIGKILLs the recorded agent process group and deletes env.json', () => scenario(async (f) => {
  const { dir, run } = intakeRun({ spec: f.agentSpec(), target: f.target, task: 'x' });
  const grand = "require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'ignore'}); setTimeout(()=>{},60000)";
  const child = cp.spawn(process.execPath, ['-e', grand], { detached: true, stdio: 'ignore' });
  child.unref();
  recordAgentPid(dir, child.pid); // pid + start identity, as the supervisor does
  fs.writeFileSync(path.join(dir, 'env.json'), '{}');
  R.touchHeartbeat(dir); age(path.join(dir, 'heartbeat'), 10 * 60_000); // lost
  const c = reply();
  await cancelCmd.run([run.spec.runId], c);
  t.eq(c.out.finalizedHere, true);
  t.ok(await until(() => !alive(child.pid), 5000));
  t.ok(!fs.existsSync(path.join(dir, 'env.json')));
  t.ok(!fs.existsSync(path.join(dir, 'agent.pid')));
  t.eq(R.readJson(path.join(dir, 'exit')).code, 130);
}));

t.test('H3: SIGTERM to the runner process kills the agent tree and finishes the run as cancelled', () => scenario(async (f) => {
  f.setMode('sleep');
  const { dir } = intakeRun({ spec: f.agentSpec(), target: f.target, task: 'x' });
  const runner = cp.spawn(process.execPath, [path.join(__dirname, '..', 'worker-run-entry.cjs'), dir], { stdio: 'ignore' });
  t.ok(await until(() => fs.existsSync(path.join(dir, 'agent.pid'))));
  const agentPid = Number.parseInt(fs.readFileSync(path.join(dir, 'agent.pid'), 'utf8'), 10);
  t.ok(alive(agentPid));
  runner.kill('SIGTERM');
  t.ok(await until(() => fs.existsSync(path.join(dir, 'exit'))));
  t.eq(R.readJson(path.join(dir, 'exit')).failure, 'cancelled');
  t.ok(await until(() => !alive(agentPid), 5000));
  t.eq(R.acquireBusy('agent', 'probe').ok, true); R.releaseBusy('agent', 'probe');
}));

t.test('H2: lost busy ownership mid-run aborts the agent (watchdog thread) and fails with lock, nothing pushed', () => scenario(async (f) => {
  f.setMode('sleep');
  const { dir } = intakeRun({ spec: f.agentSpec(), target: f.target, task: 'x' });
  const done = runRun(dir);
  t.ok(await until(() => fs.existsSync(path.join(dir, 'agent.pid'))));
  fs.writeFileSync(R.busyFile('agent'), OTHER); // someone reclaimed the clone
  await done;
  t.eq(R.readJson(path.join(dir, 'exit')).failure, 'lock');
  t.ok(!f.onOrigin());
}));

t.test('H2: heartbeat tick touches while owned, reports lost + drops sentinel when not', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-tick-'));
  try {
    const busyFile = path.join(d, 'agent.busy');
    fs.writeFileSync(busyFile, 'run-a');
    t.eq(tick({ dir: d, busyFile, runId: 'run-a' }), 'ok');
    t.ok(fs.existsSync(path.join(d, 'heartbeat')));
    fs.writeFileSync(busyFile, 'run-b');
    t.eq(tick({ dir: d, busyFile, runId: 'run-a' }), 'lost');
    t.ok(fs.readFileSync(path.join(d, 'cancelled'), 'utf8').includes('busy-ownership-lost'));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

t.test('H2: hung git is killed by the timeout (safeGit and push path)', async () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-fakegit-'));
  const oldPath = process.env.PATH;
  try {
    fs.writeFileSync(path.join(bin, 'git'), '#!/usr/bin/env node\nsetTimeout(() => {}, 60000);\n', { mode: 0o755 });
    process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
    const t0 = Date.now();
    let err = null;
    try { safeGit(bin, ['status'], { timeoutMs: 300 }); } catch (e) { err = e; }
    t.ok(err && err.code === 'ETIMEDOUT');
    process.env.RIG_GIT_TIMEOUT_MS = '300';
    const r = await pushWithRetry(bin, 'rig/m/s', { backoffMs: [] });
    t.eq([r.ok, r.failure], [false, 'push']);
    t.ok(Date.now() - t0 < 10000);
  } finally {
    delete process.env.RIG_GIT_TIMEOUT_MS;
    process.env.PATH = oldPath;
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

t.test('H2: timeout classes (network ops get the longer default)', () => {
  t.eq([gitTimeoutMs(['status']), gitTimeoutMs(['fetch']), gitTimeoutMs(['push'])], [120_000, 300_000, 300_000]);
});

t.test('M7: dirty dedicated clone is reset (tracked + untracked), ignored files kept, dirty state reported', () => scenario(async (f) => {
  const repo = f.target.repo;
  fs.writeFileSync(path.join(repo, '.gitignore'), 'cache/\n');
  f.env.git(repo, 'add', '.gitignore'); f.env.git(repo, 'commit', '-q', '-m', 'ignore');
  const sha = f.env.git(repo, 'rev-parse', 'HEAD');
  f.env.git(repo, 'push', '-q', 'origin', `${sha}:refs/heads/tmp-ig`);
  const tracked = f.env.git(repo, 'ls-files').split('\n')[0];
  fs.writeFileSync(path.join(repo, tracked), 'dirty change');
  fs.writeFileSync(path.join(repo, 'junk.txt'), 'x');
  fs.mkdirSync(path.join(repo, 'cache')); fs.writeFileSync(path.join(repo, 'cache', 'keep'), 'k');
  const spec = f.agentSpec({ startSha: sha });
  const prep = prepareAgentClone(spec, f.target);
  t.ok(prep.wasDirty.includes('junk.txt'));
  t.eq(f.env.git(repo, 'status', '--porcelain'), '');
  t.ok(!fs.existsSync(path.join(repo, 'junk.txt')));
  t.ok(fs.existsSync(path.join(repo, 'cache', 'keep')));
  t.eq(prepareAgentClone(spec, f.target).wasDirty, ''); // clean the second time
}));

t.test('L1: signal handlers are uninstalled after the run (exit file already written)', () => scenario(async (f) => {
  const before = ['SIGTERM', 'SIGHUP', 'SIGINT'].map((s) => process.listenerCount(s));
  const { dir } = intakeRun({ spec: f.agentSpec(), target: f.target, task: 'x' });
  await runRun(dir);
  t.ok(fs.existsSync(path.join(dir, 'exit')));
  t.eq(['SIGTERM', 'SIGHUP', 'SIGINT'].map((s) => process.listenerCount(s)), before);
}));

t.test('L2: finalizeAgentRun stops before rev-parse/push when the runner was signalled', () => scenario(async (f) => {
  const { dir } = intakeRun({ spec: f.agentSpec(), target: f.target, task: 'x' });
  const res = { head: null, pushed: false };
  let err = null;
  try { await finalizeAgentRun(dir, { terminated: 'SIGTERM' }, { spec: f.agentSpec() }, f.target.repo, res); } catch (e) { err = e; }
  t.eq(err && err.failure, 'cancelled');
  t.eq(res.head, null, 'no git call after the signal');
  t.eq(res.pushed, false);
}));

t.done();