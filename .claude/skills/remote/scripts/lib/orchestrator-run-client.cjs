'use strict';
/**
 * Orchestrator-side helpers over the worker run protocol. Phase 05 `dispatch`
 * and `collect` reuse startRun / fetchRunStatus / fetchRunList / waitForRun.
 */
const { execFileSync } = require('child_process');
const { RemoteError, EXIT } = require('./remote-errors.cjs');
const { execWorker, ensureWorkerCompatible } = require('./ssh-transport.cjs');
const { getMachine } = require('./machine-registry.cjs');
const V = require('./identifier-validators.cjs');

const TERMINAL = new Set(['done', 'failed', 'lost']);

/** Registry entry as the worker's `target` (name is implied by the worker's own id). */
function workerTarget(machine) {
  const { name: _name, ...target } = getMachine(machine);
  return target;
}

/** Worker error replies ({error:{...}}) become RemoteErrors. */
function unwrap(machine, { reply }) {
  if (reply && reply.error) {
    throw new RemoteError(`${machine}: ${reply.error.message}`, EXIT.ERROR, { class: reply.error.class || 'worker-error', hint: reply.error.hint || null });
  }
  return reply;
}

/** @returns {Promise<{runId, state, method}>} */
async function startRun(machine, spec, task, opts = {}) {
  await ensureWorkerCompatible(machine);
  return unwrap(machine, await execWorker(machine, 'start', [], { payload: { spec, target: workerTarget(machine), task }, ...opts }));
}

/** Foreground run on the worker (exec). timeoutMs must exceed spec.timeoutSec. */
async function execRun(machine, spec, task) {
  await ensureWorkerCompatible(machine);
  return unwrap(machine, await execWorker(machine, 'exec', [], {
    payload: { spec, target: workerTarget(machine), task }, timeoutMs: (spec.timeoutSec + 120) * 1000,
  }));
}

async function fetchRunStatus(machine, runId) {
  await ensureWorkerCompatible(machine);
  return unwrap(machine, await execWorker(machine, 'status', [V.assertRunId(runId)]));
}

async function fetchRunList(machine, slug) {
  await ensureWorkerCompatible(machine);
  return unwrap(machine, await execWorker(machine, 'list', slug ? ['--slug', V.assertSlug(slug)] : [])).runs;
}

async function cancelRun(machine, runId) {
  await ensureWorkerCompatible(machine);
  return unwrap(machine, await execWorker(machine, 'cancel', [V.assertRunId(runId)]));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll status until done/failed/lost (1 ssh per poll). */
async function waitForRun(machine, runId, { pollMs = Number(process.env.RIG_STATUS_POLL_MS) || 3000, maxMs = Infinity, onTick } = {}) {
  const t0 = Date.now();
  for (;;) {
    const st = await fetchRunStatus(machine, runId);
    if (onTick) onTick(st);
    if (TERMINAL.has(st.state)) return st;
    if (Date.now() - t0 > maxMs) throw new RemoteError(`gave up waiting for ${runId} (state ${st.state})`, EXIT.ERROR, { class: 'wait-timeout' });
    await sleep(pollMs);
  }
}

/** `origin/HEAD` sha via ls-remote in the orchestrator's repo (the remote is the source of truth). */
function resolveOriginHeadSha(cwd = process.cwd()) {
  try {
    const out = execFileSync('git', ['-C', cwd, 'ls-remote', 'origin', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
    const sha = out.split(/\s+/)[0];
    return V.assertSha(sha, 'origin HEAD sha');
  } catch (e) {
    if (e instanceof RemoteError) throw e;
    throw new RemoteError(`cannot resolve origin HEAD: ${String(e.stderr || e.message).trim().slice(-200)}`, EXIT.ERROR, { class: 'ls-remote-failed', hint: 'pass --ref <sha>' });
  }
}

module.exports = { TERMINAL, workerTarget, startRun, execRun, fetchRunStatus, fetchRunList, cancelRun, waitForRun, resolveOriginHeadSha };
