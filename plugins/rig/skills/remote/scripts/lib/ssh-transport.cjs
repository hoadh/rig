'use strict';
/**
 * Orchestrator -> worker transport. ssh (argv, never a local shell) or local
 * spawn (machine === self or RIG_REMOTE_TRANSPORT=local). Replies are
 * nonce-framed (see rig-json-nonce-framing). Failures throw RemoteError(5, class).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RemoteError, EXIT } = require('./remote-errors.cjs');
const framing = require('./rig-json-nonce-framing.cjs');
const { buildWorkerInvocation } = require('./remote-command-builder.cjs');
const { getMachine, selfMachineId } = require('./machine-registry.cjs');
const V = require('./identifier-validators.cjs');
const { runChild, MAX_OUTPUT_BYTES } = require('./capped-child-process-runner.cjs');
const { readRigVersion, checkWorkerCompat, WORKER_INSTALL_HINT } = require('./rig-version-compat.cjs');

const DEFAULT_TIMEOUT_MS = 60_000;
// Spike signatures: bash 127 "command not found"; cmd "is not recognized as an internal or external command";
// powershell "is not recognized as the name of a cmdlet".
const NOT_FOUND_RE = /not found|not recognized/i;

/** Hardened ssh argv. No ProxyCommand override (jump hosts); `--` ends options. */
function buildSshArgv(target, remoteCommand) {
  V.assertSshTarget(target, 'ssh target');
  return [
    '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
    '-o', 'ForwardAgent=no', '-o', 'ClearAllForwardings=yes',
    '-o', 'PermitLocalCommand=no', '-o', 'ForwardX11=no',
    '--', target, remoteCommand,
  ];
}

const tail = (s, n = 400) => String(s).trim().slice(-n);

/** Map a finished process with no usable framed reply to a transport error class. */
function classifyFailure({ code, stderr }) {
  if (code === 255) {
    return { cls: 'unreachable', message: 'ssh could not reach the machine', hint: tail(stderr) };
  }
  if (code === 127 || code === 9009 || NOT_FOUND_RE.test(String(stderr))) {
    return {
      cls: 'command-not-found',
      message: 'worker command not found on the machine',
      hint: `set an absolute "node" path in the registry (non-interactive PATH lacks node); if node is fine, ${WORKER_INSTALL_HINT}. stderr: ${tail(stderr)}`,
    };
  }
  return { cls: 'bad-output', message: 'worker returned no valid framed reply', hint: `exit ${code}; stderr: ${tail(stderr)}` };
}

/**
 * Resolve the worker script for the local transport: override > the runtime copy (same path ssh workers use, only
 * when its VERSION stamp exists) > a 1.x global install > this checkout.
 */
function localWorkerPath() {
  if (process.env.RIG_REMOTE_WORKER_PATH) return process.env.RIG_REMOTE_WORKER_PATH;
  const runtime = path.join(os.homedir(), '.claude', 'rig', 'runtime');
  if (fs.existsSync(path.join(runtime, 'VERSION')) && fs.existsSync(path.join(runtime, 'remote', 'worker.cjs'))) return path.join(runtime, 'remote', 'worker.cjs');
  const legacy = path.join(os.homedir(), '.claude', 'skills', 'remote', 'scripts', 'worker.cjs');
  return fs.existsSync(legacy) ? legacy : path.join(__dirname, '..', 'worker.cjs');
}

const useLocal = (machine) => process.env.RIG_REMOTE_TRANSPORT === 'local' || machine === selfMachineId();

/**
 * Env of a LOCAL-transport worker. With RIG_REMOTE_TRANSPORT=local the worker
 * plays `machine`, so it must see that id (not the orchestrator's RIG_MACHINE);
 * RIG_LOOPBACK_ROOT (loopback e2e) additionally gives each machine its own
 * RIG_HOME. Real ssh and machine===self runs are untouched.
 */
function localWorkerEnv(machine) {
  if (process.env.RIG_REMOTE_TRANSPORT !== 'local') return process.env;
  const env = { ...process.env, RIG_MACHINE: machine };
  if (process.env.RIG_LOOPBACK_ROOT) {
    env.RIG_HOME = path.join(process.env.RIG_LOOPBACK_ROOT, machine, 'rig-home');
    delete env.RIG_RUNS_DIR;
  }
  return env;
}

/**
 * Run `worker.cjs <sub> [args]` on a machine.
 * @returns {Promise<{code:number, reply:object, stderr:string}>}
 */
async function execWorker(machine, sub, args = [], { payload, timeoutMs = DEFAULT_TIMEOUT_MS, machineConfig } = {}) {
  V.assertSub(sub, 'worker subcommand');
  const nonce = framing.makeNonce();
  const stdin = framing.buildEnvelope(nonce, payload);
  let res;
  if (useLocal(machine)) {
    args.forEach((a) => V.assertInvocationToken(a, 'worker argument'));
    res = await runChild(process.execPath, [localWorkerPath(), sub, ...args], { cwd: os.homedir(), stdin, timeoutMs, env: localWorkerEnv(machine) });
  } else {
    const cfg = machineConfig || getMachine(machine);
    res = await runChild('ssh', buildSshArgv(cfg.ssh, buildWorkerInvocation(cfg, sub, args)), { cwd: os.homedir(), stdin, timeoutMs });
  }
  const parsed = framing.parseReply(res.stdout, nonce);
  if (parsed.status === 'ok') return { code: res.code, reply: parsed.reply, stderr: res.stderr };
  if (parsed.status === 'multiple') throw new RemoteError('worker sent more than one framed reply', EXIT.TRANSPORT, { class: 'bad-output', hint: tail(res.stderr) });
  if (parsed.status === 'invalid-json') throw new RemoteError('worker framed reply is not valid JSON', EXIT.TRANSPORT, { class: 'bad-output', hint: parsed.error });
  const c = classifyFailure(res);
  throw new RemoteError(`${machine}: ${c.message}`, EXIT.TRANSPORT, { class: c.cls, hint: c.hint });
}

const handshakes = new Map(); // machine -> Promise<info>

/** Protocol handshake via `worker.cjs info`, once per process per machine. */
function ensureWorkerCompatible(machine, opts) {
  if (!handshakes.has(machine)) {
    const p = execWorker(machine, 'info', [], opts).then(({ reply }) => {
      // A worker that replies with an error (e.g. an incomplete runtime copy) has no version to compare
      if (reply.error) throw new RemoteError(`${machine}: ${reply.error.message}`, EXIT.TRANSPORT, { class: reply.error.class || 'worker-error', hint: reply.error.hint || WORKER_INSTALL_HINT });
      const refused = checkWorkerCompat(reply, { protocol: framing.PROTOCOL_VERSION, rigVersion: readRigVersion() });
      if (refused) throw new RemoteError(`${machine}: ${refused.message}`, EXIT.TRANSPORT, { class: refused.cls, hint: refused.hint });
      return reply;
    });
    handshakes.set(machine, p);
    p.catch(() => handshakes.delete(machine)); // failures are retryable
  }
  return handshakes.get(machine);
}

module.exports = { buildSshArgv, classifyFailure, execWorker, ensureWorkerCompatible, localWorkerPath, MAX_OUTPUT_BYTES };
