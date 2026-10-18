#!/usr/bin/env node
'use strict';
/**
 * Detached runner: `node worker-run-entry.cjs <runDir>`. One process per run.
 * prepare (known-good baseline gate) -> claude|command -> integrity check -> owns
 * guard -> push-on-advance -> classify. The `finally` ALWAYS writes
 * result.json, then the atomic `exit` file (last, create-only so a worker-side
 * cancel/not-started finalize wins), then releases the busy marker. No
 * auto-resume on any failure. Nothing here prints to stdout.
 * Lifecycle safety: heartbeat + busy-ownership watchdog run on a worker thread
 * (sync git cannot freeze it); SIGTERM/SIGHUP/SIGINT kill the recorded agent
 * process tree; ownership of the busy marker is verified at start.
 */
const fs = require('fs');
const path = require('path');
const R = require('./lib/run-directory.cjs');
const { buildAgentChildEnv } = require('./lib/agent-child-env.cjs');
const { buildClaudeArgs, resolveClaudeBinary, parseClaudeJson, classifyAgentOutcome } = require('./lib/claude-headless-args.cjs');
const { buildShellArgv } = require('./lib/remote-command-builder.cjs');
const { superviseChild } = require('./lib/run-child-process-supervisor.cjs');
const { prepareAgentClone } = require('./lib/worker-repo-preparer.cjs');
const { safeGit } = require('./lib/safe-git-runner.cjs');
const { prepareTestClone } = require('./lib/worker-test-clone-preparer.cjs');
const { assertKnownGoodBaseline } = require('./lib/git-baseline-gate.cjs');
const { checkOwnsAndDenylist } = require('./lib/owns-denylist-push-guard.cjs');
const { pushWithRetry } = require('./lib/worker-branch-pusher.cjs');
const { loadEnvHandoff } = require('./lib/runner-env-handoff.cjs');
const { killRecordedAgent } = require('./lib/agent-process-registry.cjs');
const { startHeartbeatThread } = require('./lib/runner-heartbeat-thread.cjs');

const HEARTBEAT_MS = () => Number(process.env.RIG_HEARTBEAT_MS) || 30_000;
const EXIT_CODE = { cancelled: 130, timeout: 124 };
const SIGNALS = ['SIGTERM', 'SIGHUP', 'SIGINT'];

const cancelRequested = (dir, ctl) => !!ctl.terminated || R.exists(path.join(dir, 'cancelled'));
/** The heartbeat thread drops this marker in `cancelled` when the busy marker is no longer ours. */
const ownershipLost = (dir) => { try { return fs.readFileSync(path.join(dir, 'cancelled'), 'utf8').includes('busy-ownership-lost'); } catch { return false; } };
const holdsBusy = (run, runId) => { try { return fs.readFileSync(R.busyFile(R.busyNameForRun(run)), 'utf8').trim() === runId; } catch { return false; } };

/** On SIGTERM/SIGHUP/SIGINT (tmux kill, reboot, ssh drop): kill the agent tree now; the run then finishes as `cancelled`. @returns {()=>void} uninstall */
function installSignalHandlers(dir, ctl) {
  const handler = (sig) => { ctl.terminated = ctl.terminated || sig; killRecordedAgent(dir, 'SIGKILL'); };
  SIGNALS.forEach((sig) => process.on(sig, handler));
  return () => SIGNALS.forEach((sig) => process.off(sig, handler));
}

/** Throws when the run must stop: signal, cancel sentinel, or lost busy ownership. */
function assertNotAborted(dir, ctl) {
  if (ctl.terminated) throw new R.RunFailure('cancelled', `runner terminated by ${ctl.terminated}`);
  if (ownershipLost(dir)) throw new R.RunFailure('lock', 'busy marker no longer held by this run (another run may own the clone); aborted, nothing pushed');
}

const childEnv = (target) => buildAgentChildEnv(process.env, target);

/** Spawn claude with task.md on stdin; stdout JSON -> result.raw.json, stderr -> log. */
async function runClaude(dir, run, cwd, ctl) {
  const bin = resolveClaudeBinary(run.target);
  if (!bin) throw new R.RunFailure('prepare', 'claude binary not found', { hint: 'set "claude" (absolute path) in the registry' });
  return superviseChild({
    cmd: bin, argv: buildClaudeArgs(run.spec), cwd, env: childEnv(run.target), stdinText: fs.readFileSync(path.join(dir, 'task.md'), 'utf8'),
    logFile: path.join(dir, 'log'), stdoutFile: path.join(dir, 'result.raw.json'), pidDir: dir,
    timeoutMs: run.spec.timeoutSec * 1000, shouldCancel: () => cancelRequested(dir, ctl),
  });
}

/** Spawn the user command under the machine shell; all output -> log only. */
function runCommand(dir, run, cwd, ctl) {
  const [cmd, ...argv] = buildShellArgv(run.target.shell, run.spec.command);
  return superviseChild({
    cmd, argv, cwd, env: childEnv(run.target), logFile: path.join(dir, 'log'), pidDir: dir,
    timeoutMs: run.spec.timeoutSec * 1000, shouldCancel: () => cancelRequested(dir, ctl),
  });
}

/** Post-agent steps: tamper check, owns guard, push-on-advance. Mutates res. */
async function finalizeAgentRun(dir, ctl, run, cwd, res) {
  assertNotAborted(dir, ctl); // a signal between the agent exit and here: no rev-parse, no push
  assertKnownGoodBaseline(cwd, `run ${run.spec.runId} after agent`); // stored baseline = h0
  res.head = safeGit(cwd, ['rev-parse', 'HEAD']);
  res.dirty = safeGit(cwd, ['status', '--porcelain']) !== '';
  if (res.head === run.spec.startSha) return;
  res.violations = checkOwnsAndDenylist(cwd, run.spec.baseSha, res.head, run.spec.owns);
  if (res.violations.length) throw new R.RunFailure('owns-violation', `${res.violations.length} path(s) violate owns/denylist; nothing pushed`);
  assertKnownGoodBaseline(cwd, `run ${run.spec.runId} before push`); // last check before the privileged push
  assertNotAborted(dir, ctl);
  const push = await pushWithRetry(cwd, run.spec.branch, { head: res.head }); // exactly the sha the guard checked
  res.pushed = push.ok;
  if (!push.ok) throw new R.RunFailure(push.failure, `push of ${run.spec.branch} failed after ${push.attempts} attempt(s)`, { detail: push.detail });
}

async function execute(dir, run, res, ctl) {
  const agent = run.spec.kind === 'agent';
  const prep = agent ? prepareAgentClone(run.spec, run.target) : prepareTestClone(run.spec, run.target);
  res.startSha = agent ? run.spec.startSha : run.spec.ref;
  if (prep.wasDirty) res.preparedDirty = prep.wasDirty; // visibility: leftovers discarded from the dedicated clone
  assertNotAborted(dir, ctl); // a signal/ownership loss during (blocking) prepare must not start the child
  const out = await (agent ? runClaude : runCommand)(dir, run, prep.cwd, ctl);
  if (out.spawnError) throw new R.RunFailure('prepare', `cannot start child: ${out.spawnError}`);
  res.code = out.code;
  assertNotAborted(dir, ctl); // signalled / ownership lost: never tamper-check-and-push
  if (!agent) {
    res.failure = out.cancelled ? 'cancelled' : out.timedOut ? 'timeout' : null;
    return;
  }
  const json = parseClaudeJson(R.exists(path.join(dir, 'result.raw.json')) ? fs.readFileSync(path.join(dir, 'result.raw.json'), 'utf8') : '');
  if (json) res.claude = { subtype: json.subtype, is_error: json.is_error, num_turns: json.num_turns, total_cost_usd: Number.isFinite(json.total_cost_usd) ? json.total_cost_usd : undefined, session_id: json.session_id, result: String(json.result || '').slice(0, 2000) };
  const agentFailure = classifyAgentOutcome({ code: out.code, timedOut: out.timedOut, cancelled: out.cancelled, stderr: R.tailFile(path.join(dir, 'log'), 40), json });
  await finalizeAgentRun(dir, ctl, run, prep.cwd, res); // tamper/owns/push failures take precedence (stranded work)
  res.failure = agentFailure;
}

/** @returns {Promise<number>} runner exit code (the `exit` file holds the run's own code) */
async function runRun(dir) {
  if (R.exists(path.join(dir, 'exit'))) return 0; // finished runs are never rerun
  try { fs.closeSync(fs.openSync(path.join(dir, 'runner.lock'), 'wx', 0o600)); } catch { return 0; } // double fire
  const run = R.readJson(path.join(dir, 'run.json'));
  const res = { runId: path.basename(dir), failure: null, detail: null, code: 0, startSha: null, head: null, pushed: false, violations: [], claude: null, dirty: false };
  const ctl = { terminated: null };
  const uninstallSignals = installSignalHandlers(dir, ctl);
  let heartbeat = null;
  try {
    if (!run) throw new R.RunFailure('prepare', 'run.json unreadable');
    if (!holdsBusy(run, res.runId)) throw new R.RunFailure('lock', 'busy marker not held by this run at start (cancelled, swept or reclaimed); not running');
    R.touchHeartbeat(dir);
    heartbeat = startHeartbeatThread({ dir, busyFile: R.busyFile(R.busyNameForRun(run)), runId: res.runId, intervalMs: HEARTBEAT_MS() });
    if (R.exists(path.join(dir, 'cancelled'))) throw new R.RunFailure('cancelled', 'cancelled before start');
    await execute(dir, run, res, ctl);
  } catch (e) {
    if (e instanceof R.RunFailure) {
      res.failure = e.failure;
      res.detail = [e.message, e.extra.detail, e.extra.hint].filter(Boolean).join(' | ');
    } else {
      res.failure = 'prepare';
      res.detail = `unexpected: ${e && e.message}`;
    }
  } finally {
    if (heartbeat) heartbeat.stop();
    killRecordedAgent(dir); // belt and braces: no agent survives its run
    let code = res.code === null || res.code === undefined ? 1 : res.code;
    if (res.failure && EXIT_CODE[res.failure]) code = EXIT_CODE[res.failure];
    else if (res.failure && code === 0) code = 1;
    if (!R.exists(path.join(dir, 'exit'))) { // else a worker-side cancel/not-started finalize already owns the outcome
      try {
        R.writeJsonAtomic(path.join(dir, 'result.json'), { ...res, exit: code, finishedAt: Date.now() });
      } catch (e) { fs.writeSync(2, `result.json not written: ${e.message}\n`); }
      R.writeFileExclusive(path.join(dir, 'exit'), `${JSON.stringify({ code, failure: res.failure, finishedAt: Date.now() })}\n`); // LAST
    }
    if (run) R.releaseBusy(R.busyNameForRun(run), res.runId);
    uninstallSignals(); // only after the exit file is written: a late SIGTERM must not kill the runner mid-finalize
  }
  return 0;
}

if (require.main === module) {
  const runDir = path.resolve(process.argv[2] || '');
  loadEnvHandoff(runDir); // auth env from the launcher (tmux server env may lack it); file is deleted
  runRun(runDir).then((c) => { process.exitCode = c; }, (e) => { process.stderr.write(`${e.stack}\n`); process.exitCode = 1; });
}

module.exports = { runRun, finalizeAgentRun };
