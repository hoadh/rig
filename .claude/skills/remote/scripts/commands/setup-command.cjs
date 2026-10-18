'use strict';
/**
 * setup <machine...> [--accept-existing-clone] [--git-name n --git-email e]
 * Stage-1 preparation of registered workers, one machine at a time, stopping a machine at its
 * first blocking step: registry entry -> ssh/node/claude probe -> Rig installed (protocol) ->
 * worker `prepare` (create the dedicated clone of this repo's origin + record its baseline).
 * Machines that got that far are then checked with the full `doctor`. Every problem prints a
 * `fix:` line. Exit 0 only when every machine is ready and doctor passes.
 */
const { EXIT, usageError } = require('../lib/remote-errors.cjs');
const { parseFlags } = require('../lib/cli-flag-parser.cjs');
const V = require('../lib/identifier-validators.cjs');
const { getMachine } = require('../lib/machine-registry.cjs');
const { PROTOCOL_VERSION } = require('../lib/rig-json-nonce-framing.cjs');
const { git } = require('../lib/rig-local-worktree.cjs');
const { stripUrlCredentials } = require('../lib/secret-redaction.cjs');
const { bootstrapProbe } = require('../lib/doctor-bootstrap-probe.cjs');
const { withFixHints } = require('../lib/doctor-checks.cjs');
const { INSTALL_RIG } = require('../lib/doctor-fix-hints.cjs');

const { PREPARE_TIMEOUT_MS } = require('../lib/worker-dedicated-clone-bootstrapper.cjs');

const USAGE = 'usage: setup <machine...> [--accept-existing-clone] [--git-name <name> --git-email <email>]';

/** Orchestrator origin as the worker should clone it: never forward embedded credentials. */
function cloneableOrigin(url) {
  return stripUrlCredentials(String(url || '').trim());
}

const step = (id, status, msg, fix) => ({ id, status, msg, ...(fix ? { fix } : {}) });

/** Clone step from the worker `prepare` reply. */
function cloneStep(reply) {
  if (reply.error) return step('clone', 'fail', reply.error.message, reply.error.hint);
  const msgs = {
    cloned: `created dedicated clone ${reply.repo}, baseline recorded`,
    'identity-set': `git identity set in ${reply.repo}, baseline re-recorded`,
    baselined: `existing clone ${reply.repo} accepted, baseline recorded`,
    unchanged: `clone ${reply.repo} ok, baseline matches`,
  };
  if (reply.action === 'needs-accept') return step('baseline', 'fail', `clone ${reply.repo} has no usable baseline`, reply.hint);
  return step('clone', 'ok', msgs[reply.action] || reply.action);
}

/** @returns {Promise<{machine, steps, ready:boolean}>} ready = worth running doctor on */
async function setupMachine(name, opts, client) {
  const cfg = getMachine(name);
  const steps = [];
  const hinted = (checks) => withFixHints(checks, { name, cfg });
  const done = (ready) => ({ machine: name, steps, ready });

  const boot = await bootstrapProbe(name, cfg);
  steps.push(...hinted([
    step('ssh', boot.ssh.ok ? 'ok' : 'fail', boot.ssh.ok ? 'reachable without a prompt' : boot.ssh.detail),
    step('node', boot.node.ok ? 'ok' : 'fail', boot.node.detail),
    // claude is only needed for agent runs: report it, but still prepare the clone
    step('claude', boot.claude.ok ? 'ok' : 'fail', boot.claude.detail),
  ]));
  if (!boot.ssh.ok || !boot.node.ok) return done(false);

  try {
    const info = (await client.execWorker(name, 'info')).reply;
    if (info.protocol !== PROTOCOL_VERSION) {
      steps.push(...hinted([step('protocol', 'fail', `worker protocol ${info.protocol} != ${PROTOCOL_VERSION}`)]));
      return done(false);
    }
    steps.push(step('rig', 'ok', `Rig ${info.rigVersion} (protocol ${info.protocol})`));
  } catch (e) {
    steps.push(...hinted([step('reach', 'fail', `Rig worker not runnable: ${String(e.message).split('\n')[0]}`)]));
    return done(false);
  }

  try {
    const { reply } = await client.execWorker(name, 'prepare', [], {
      payload: { target: client.workerTarget(name), originUrl: opts.originUrl, acceptExisting: opts.acceptExisting, identity: opts.identity },
      timeoutMs: PREPARE_TIMEOUT_MS,
    });
    steps.push(cloneStep(reply));
  } catch (e) {
    const msg = String(e.message).split('\n')[0];
    // same protocol but no `prepare`: the worker's Rig predates setup
    steps.push(step('clone', 'fail', msg, /unknown subcommand/.test(msg) ? INSTALL_RIG : e.hint));
  }
  return done(steps.every((s) => s.status === 'ok' || s.id === 'claude'));
}

function printSteps(r) {
  process.stdout.write(`${r.machine} (setup)\n`);
  for (const s of r.steps) {
    process.stdout.write(`  ${s.status.toUpperCase().padEnd(4)} ${s.id.padEnd(16)} ${s.msg}\n`);
    if (s.fix) process.stdout.write(`       fix: ${s.fix}\n`);
  }
}

function parseIdentity(flags) {
  if (!flags['git-name'] && !flags['git-email']) return null;
  if (!flags['git-name'] || !flags['git-email']) throw usageError('--git-name and --git-email go together', USAGE);
  return { name: flags['git-name'], email: flags['git-email'] };
}

async function run(argv, ctx = {}) {
  const { flags, positional } = parseFlags(argv, { '--accept-existing-clone': 'bool', '--git-name': 'value', '--git-email': 'value' });
  if (!positional.length) throw usageError(USAGE);
  const names = positional.map((n) => V.assertMachineName(n, 'machine'));
  names.forEach((n) => getMachine(n)); // unknown machine -> exit 2 before any ssh
  const origin = git(process.cwd(), ['remote', 'get-url', 'origin']);
  if (origin.status !== 0) throw usageError('run setup inside the project repo: it has no "origin" remote', 'workers clone the same origin as the orchestrator');
  const opts = { originUrl: cloneableOrigin(origin.stdout), acceptExisting: Boolean(flags['accept-existing-clone']), identity: parseIdentity(flags) };
  const client = ctx.client || { ...require('../lib/orchestrator-run-client.cjs'), ...require('../lib/ssh-transport.cjs') };

  const results = [];
  for (const name of names) results.push(await setupMachine(name, opts, client)); // sequential: readable output
  results.forEach(printSteps);

  const ready = results.filter((r) => r.ready).map((r) => r.machine);
  if (!ready.length) {
    process.stdout.write('setup: FAIL (fix the lines above, then rerun setup)\n');
    return EXIT.ERROR;
  }
  process.stdout.write(`\nrunning doctor on ${ready.join(', ')} ...\n`);
  const doctor = ctx.doctor || require('./doctor-command.cjs').run;
  const doctorCode = await doctor(ready, { client: ctx.client });
  const allReady = ready.length === names.length;
  process.stdout.write(allReady && doctorCode === EXIT.OK ? 'setup: ok (next: `machines` to see what /rig:plan will offer)\n' : 'setup: FAIL (fix the lines above, then rerun setup)\n');
  return allReady && doctorCode === EXIT.OK ? EXIT.OK : EXIT.ERROR;
}

module.exports = { run, cloneableOrigin, setupMachine };
