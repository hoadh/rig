'use strict';
/**
 * Real worker.cjs subprocesses speaking the nonce protocol over stdin/stdout:
 * start (detached runner), status, list, exec, cancel. Local only, stub claude.
 */
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const { setup } = require('./worker-run-flow-fixture.cjs');
const framing = require('../lib/rig-json-nonce-framing.cjs');
const R = require('../lib/run-directory.cjs');

const WORKER = path.join(__dirname, '..', 'worker.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @returns {{reply:object, stdout:string, status:number}} */
function call(sub, args, payload) {
  const nonce = framing.makeNonce();
  const p = spawnSync(process.execPath, [WORKER, sub, ...args], { input: framing.buildEnvelope(nonce, payload), encoding: 'utf8', env: process.env, timeout: 60_000 });
  const parsed = framing.parseReply(p.stdout, nonce);
  if (parsed.status !== 'ok') throw new Error('bad protocol reply: ' + parsed.status + ' ' + p.stderr);
  return { reply: parsed.reply, stdout: p.stdout, status: p.status };
}
async function waitExit(runId, ms = 30_000) {
  const dir = R.runDirOf(runId);
  for (let i = 0; i < ms / 100 && !R.exists(path.join(dir, 'exit')); i++) await sleep(100);
  return R.readJson(path.join(dir, 'exit'));
}
async function scenario(fn) {
  const f = setup();
  try { await fn(f); } finally { f.cleanup(); }
}
const tmuxAvailable = () => { try { execFileSync('tmux', ['-V'], { stdio: 'ignore' }); return true; } catch { return false; } };

t.test('start returns at once (starting), runner finishes detached; status + list report it; restart is idempotent', () => scenario(async (f) => {
  f.setMode('commit');
  const spec = f.agentSpec();
  const payload = { spec, target: f.target, task: 'go' };
  const s = call('start', [], payload);
  t.eq([s.reply.runId, s.reply.state, s.reply.method], [spec.runId, 'starting', process.platform === 'win32' ? 'schtasks-headless' : 'node-detached']);
  const again = call('start', [], payload); // same runId, same spec: no second process
  t.eq(again.reply.method, 'existing');
  t.ok(['starting', 'running', 'done'].includes(again.reply.state));
  const exit = await waitExit(spec.runId);
  t.eq([exit.code, exit.failure], [0, null]);
  t.ok(!R.exists(path.join(R.runDirOf(spec.runId), 'env.json')), 'runner must delete env.json after start');
  const st = call('status', [spec.runId]).reply;
  t.eq([st.state, st.pushed, st.result.pushed], ['done', true, true]);
  t.ok(f.onOrigin());
  t.eq(f.stubRan(), 1, 'stub claude must have run exactly once');
  t.eq(call('list', []).reply.runs.map((r) => [r.runId, r.state]), [[spec.runId, 'done']]);
  t.eq(call('start', [], payload).reply.error.class, 'finished');
  t.eq(call('status', ['r2601019999-zzzzzz']).reply.error.class, 'not-found');
}));

t.test('busy: second agent start refused while one is running; cancel then ends it (exit 130)', () => scenario(async (f) => {
  f.setMode('sleep');
  const a = f.agentSpec();
  t.eq(call('start', [], { spec: a, target: f.target, task: 'go' }).reply.state, 'starting');
  t.eq(call('start', [], { spec: f.agentSpec(), target: f.target, task: 'go' }).reply.error.class, 'busy');
  for (let i = 0; i < 100 && R.readRunState(R.runDirOf(a.runId)).state !== 'running'; i++) await sleep(100);
  t.eq(call('status', [a.runId]).reply.state, 'running');
  call('cancel', [a.runId]);
  const exit = await waitExit(a.runId);
  t.eq([exit.failure, exit.code], ['cancelled', 130]);
  t.eq(call('cancel', [a.runId]).reply.note, 'already finished');
}));

t.test('exec: foreground; command output stays in the log, protocol stdout is exactly one RIGJSON line', () => scenario(async (f) => {
  const spec = f.commandSpec(process.platform === 'win32' ? "echo NOISY-OUTPUT-MARKER; [Console]::Error.WriteLine('err-line')" : 'echo NOISY-OUTPUT-MARKER; echo err-line 1>&2');
  const r = call('exec', [], { spec, target: f.target });
  t.eq([r.reply.exit, r.reply.failure], [0, null]);
  t.eq(r.stdout.trim().split('\n').length, 1);
  t.ok(r.stdout.startsWith('RIGJSON:'));
  t.ok(fs.readFileSync(path.join(R.runDirOf(spec.runId), 'log'), 'utf8').includes('NOISY-OUTPUT-MARKER'));
  t.eq(call('exec', [], { spec, target: f.target }).reply.error.class, 'finished');
}));

t.test('tmux launcher (when tmux exists): session rig-<id> runs the runner and the run completes', () => scenario(async (f) => {
  if (!tmuxAvailable()) return console.log('       (skipped: no tmux)');
  delete process.env.RIG_REMOTE_NO_TMUX;
  f.setMode('commit');
  const spec = f.agentSpec();
  try {
    t.eq(call('start', [], { spec, target: f.target, task: 'go' }).reply.method, 'tmux');
    const exit = await waitExit(spec.runId);
    t.eq([exit.code, exit.failure], [0, null]);
  } finally {
    process.env.RIG_REMOTE_NO_TMUX = '1';
    try { execFileSync('tmux', ['kill-session', '-t', `rig-${spec.runId}`], { stdio: 'ignore' }); } catch { /* already exited */ }
  }
}));

t.done();
