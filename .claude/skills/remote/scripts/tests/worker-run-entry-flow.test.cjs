'use strict';
/** In-process runner scenarios (runRun) with a stub claude and local bare origin. No ssh, no network. */
const fs = require('fs');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const { setup, BRANCH } = require('./worker-run-flow-fixture.cjs');
const R = require('../lib/run-directory.cjs');
const { intakeRun } = require('../lib/worker-run-intake.cjs');
const { runRun } = require('../worker-run-entry.cjs');
const cancelCmd = require('../worker-commands/cancel-command.cjs');

/** Intake + run to completion. @returns {{dir, exit, result, state}} */
async function runToEnd(f, spec) {
  const { dir } = intakeRun({ spec, target: f.target, task: 'do the thing' });
  await runRun(dir);
  return { dir, exit: R.readJson(path.join(dir, 'exit')), result: R.readJson(path.join(dir, 'result.json')), state: R.readRunState(dir) };
}
async function scenario(fn) {
  const f = setup();
  try { await fn(f); } finally { f.cleanup(); }
}

t.test('agent commit inside owns is pushed; exit written; busy released', () => scenario(async (f) => {
  f.setMode('commit');
  const r = await runToEnd(f, f.agentSpec());
  t.eq([r.exit.code, r.exit.failure, r.state.state, r.result.pushed], [0, null, 'done', true]);
  t.ok(f.onOrigin());
  t.eq(R.acquireBusy('agent', 'probe').ok, true); // released
  R.releaseBusy('agent', 'probe');
}));

t.test('.github change: catch-all owns -> failed:owns-violation, not pushed; explicit owns -> pushed', () => scenario(async (f) => {
  f.setMode('github');
  const bad = await runToEnd(f, f.agentSpec({ owns: ['**'] }));
  t.eq([bad.exit.failure, bad.state.state, f.onOrigin()], ['owns-violation', 'failed', false]);
  f.env.git(f.target.repo, 'checkout', '-q', 'main'); f.env.git(f.target.repo, 'branch', '-D', BRANCH);
  const ok = await runToEnd(f, f.agentSpec({ owns: ['.github/workflows/**'] }));
  t.eq([ok.exit.failure, ok.result.pushed, f.onOrigin()], [null, true, true]);
}));

t.test('git config modified by agent -> failed:hooks-tampered, not pushed, clone quarantined, next start refused', () => scenario(async (f) => {
  f.setMode('tamper');
  const r = await runToEnd(f, f.agentSpec());
  t.eq([r.exit.failure, f.onOrigin()], ['hooks-tampered', false]);
  f.setMode('commit');
  const next = await runToEnd(f, f.agentSpec());
  t.eq(next.exit.failure, 'prepare');
  t.ok(/quarantin/i.test(next.result.detail));
}));

t.test('agent exit 1 with commits -> pushed and failed:agent', () => scenario(async (f) => {
  f.setMode('failcommit');
  const r = await runToEnd(f, f.agentSpec());
  t.eq([r.exit.failure, r.result.pushed, f.onOrigin()], ['agent', true, true]);
  t.ok(r.exit.code !== 0);
}));

t.test('command run: done on 0, failed (no class) with its code otherwise; output only in log', () => scenario(async (f) => {
  const ok = await runToEnd(f, f.commandSpec('echo CMD-MARKER'));
  t.eq([ok.state.state, ok.exit.code], ['done', 0]);
  t.ok(fs.readFileSync(path.join(ok.dir, 'log'), 'utf8').includes('CMD-MARKER'));
  const bad = await runToEnd(f, f.commandSpec('exit 3'));
  t.eq([bad.state.state, bad.exit.code, bad.exit.failure], ['failed', 3, null]);
}));

t.test('timeout -> failed:timeout, exit 124, exit file present', () => scenario(async (f) => {
  f.setMode('sleep');
  const r = await runToEnd(f, f.agentSpec({ timeoutSec: 1 }));
  t.eq([r.exit.failure, r.exit.code, r.state.state], ['timeout', 124, 'failed']);
}));

t.test('cancel sentinel while running -> failed:cancelled, exit 130, child gone', () => scenario(async (f) => {
  f.setMode('sleep');
  const { dir } = intakeRun({ spec: f.agentSpec(), target: f.target, task: 'x' });
  const done = runRun(dir);
  for (let i = 0; i < 50 && !R.exists(path.join(dir, 'heartbeat')); i++) await new Promise((r) => setTimeout(r, 100));
  t.eq(R.readRunState(dir).state, 'running');
  R.writeFileAtomic(path.join(dir, 'cancelled'), 'x');
  t.eq(R.readRunState(dir).state, 'cancelling');
  await done;
  t.eq([R.readJson(path.join(dir, 'exit')).failure, R.readJson(path.join(dir, 'exit')).code], ['cancelled', 130]);
}));

t.test('intake: same spec twice is idempotent, changed spec rejected, second run while busy refused', () => scenario(async (f) => {
  const spec = f.agentSpec();
  const a = intakeRun({ spec, target: f.target, task: 'x' });
  t.eq(intakeRun({ spec, target: f.target, task: 'x' }).existing, true);
  try { intakeRun({ spec: { ...spec, maxTurns: 9 }, target: f.target, task: 'x' }); t.ok(false); } catch (e) { t.eq(e.exitCode, 2); }
  try { intakeRun({ spec: f.agentSpec(), target: f.target, task: 'x' }); t.ok(false); } catch (e) { t.eq(e.class, 'busy'); }
  await runRun(a.dir); // double fire: runner.lock + finished runs never rerun
  const before = fs.readFileSync(path.join(a.dir, 'exit'), 'utf8');
  await runRun(a.dir);
  t.eq(fs.readFileSync(path.join(a.dir, 'exit'), 'utf8'), before);
}));

t.test('cancel of a lost run is finalized by the worker command and frees the busy marker', () => scenario(async (f) => {
  const spec = f.agentSpec();
  const { dir } = intakeRun({ spec, target: f.target, task: 'x' });
  R.touchHeartbeat(dir);
  const old = new Date(Date.now() - 600_000);
  fs.utimesSync(path.join(dir, 'heartbeat'), old, old);
  t.eq(R.readRunState(dir).state, 'lost');
  let reply; await cancelCmd.run([spec.runId], { reply: (r) => { reply = r; } });
  t.eq(reply.finalizedHere, true);
  t.eq([R.readJson(path.join(dir, 'exit')).failure, R.readJson(path.join(dir, 'exit')).code], ['cancelled', 130]);
  t.eq(R.acquireBusy('agent', 'probe').ok, true);
  R.releaseBusy('agent', 'probe');
}));

t.test('cancel of a run still starting (no heartbeat) is finalized immediately as failed:cancelled', () => scenario(async (f) => {
  const spec = f.agentSpec();
  const { dir } = intakeRun({ spec, target: f.target, task: 'x' });
  t.eq(R.readRunState(dir).state, 'starting');
  let reply; await cancelCmd.run([spec.runId], { reply: (r) => { reply = r; } });
  t.eq(reply.finalizedHere, true);
  t.eq([R.readJson(path.join(dir, 'exit')).failure, R.readJson(path.join(dir, 'exit')).code, R.readRunState(dir).state], ['cancelled', 130, 'failed']);
  t.eq(R.acquireBusy('agent', 'probe').ok, true); // busy marker freed
  R.releaseBusy('agent', 'probe');
}));

t.test('losing same-runId intake (winner mid-flight) errors and leaves winner run dir + busy marker intact', () => scenario(async (f) => {
  const spec = f.agentSpec();
  // winner has claimed dir + marker but not yet written run.json
  const dir = R.createRunDir(spec.runId);
  t.eq(R.acquireBusy('agent', spec.runId), { ok: true });
  fs.writeFileSync(path.join(dir, 'winner-marker'), 'x');
  t.throwsRemote(() => intakeRun({ spec, target: f.target, task: 'x' }), { class: 'exists' });
  t.ok(fs.existsSync(path.join(dir, 'winner-marker')), 'winner run dir survives');
  t.eq(fs.readFileSync(path.join(R.rigHome(), 'agent.busy'), 'utf8'), spec.runId);
  // and the winner finishing normally afterwards still works for a sequential retry
  R.writeJsonAtomic(path.join(dir, 'run.json'), { v: 1, spec, target: f.target, specHash: require('../lib/run-spec-validator.cjs').specHash(spec), createdAt: Date.now() });
  t.eq(intakeRun({ spec, target: f.target, task: 'x' }).existing, true);
}));

t.done();
