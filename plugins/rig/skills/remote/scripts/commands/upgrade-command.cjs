'use strict';
/**
 * upgrade <machine...> | --all [--check] [--wait] [--json]: bring registry workers to this machine's Rig version
 * over ssh (marketplace update, plugin update, runtime refresh, then handshake + scripts-hash proof).
 * Machines run one after the other in registry order; one failure never stops the others; exit 1 when any
 * machine failed or was skipped (the orchestrator machine itself is left alone, not an error). `--check` changes no plugin, runtime or settings on any machine (the worker's `list` does its usual run housekeeping). Only registry machines: the ssh target
 * always comes from the registry, never from an argument. The steps live in lib/worker-plugin-upgrader.
 */
const { EXIT, usageError } = require('../lib/remote-errors.cjs');
const { parseFlags } = require('../lib/cli-flag-parser.cjs');
const { loadRegistry, selfMachineId } = require('../lib/machine-registry.cjs');
const { readRigVersion } = require('../lib/rig-version-compat.cjs');
const { scriptsIntegrityHash } = require('../lib/skill-scripts-integrity-hash.cjs');
const { upgradeMachine } = require('../lib/worker-plugin-upgrader.cjs');

const USAGE = 'usage: upgrade <machine...> | --all [--check] [--wait] [--json]';

/** One printable block per machine result. */
function formatResult(r) {
  const fix = r.fix ? `\n    fix: ${r.fix}` : '';
  switch (r.status) {
    case 'ok': return `${r.machine}  ${r.from || '?'} -> ${r.to}  ok${r.note ? ` (${r.note})` : ''}`;
    case 'current': return `${r.machine}  ${r.from || '?'}  up to date (${r.note})`;
    case 'would-upgrade': return `${r.machine}  ${r.from || '?'} -> ${r.to}  would upgrade (${r.note})`;
    case 'self': return `${r.machine}  not touched: ${r.detail}${fix}`;
    case 'skipped': return `${r.machine}  skipped: ${r.detail}${fix}`;
    default: return `${r.machine}  FAILED at ${r.step}: ${r.detail}${fix}`;
  }
}

/** @param {string[]} argv @param {object} [ctx] @param {{upgrade?: Function, orch?: object, registry?: object}} [seams] test seams */
async function run(argv, ctx = {}, { upgrade = upgradeMachine, orch, registry } = {}) {
  const { flags, positional } = parseFlags(argv, { '--all': 'bool', '--check': 'bool', '--wait': 'bool', '--json': 'bool' });
  if (Boolean(flags.all) === positional.length > 0) throw usageError(USAGE, 'name machines, or pass --all (not both)');
  const reg = registry || loadRegistry();
  const names = flags.all ? Object.keys(reg.machines) : [...new Set(positional)];
  if (!names.length) throw usageError('the registry has no machines', 'add one with `remote.cjs register`');
  const unknown = names.find((n) => !reg.machines[n]);
  if (unknown) throw usageError(`unknown machine ${JSON.stringify(unknown)}`, `registry machines: ${Object.keys(reg.machines).join(', ') || '(none)'}`);

  const target = orch || { version: readRigVersion(), hash: scriptsIntegrityHash() };
  const self = ctx.self || selfMachineId();
  const results = [];
  for (const name of names) {
    let r;
    if (name === self && process.env.RIG_REMOTE_TRANSPORT !== 'local') {
      r = { machine: name, status: 'self', from: null, to: null, detail: 'this is the orchestrator machine', fix: 'update it with `claude plugin update rig@rig-marketplace`' };
    } else {
      try {
        r = await upgrade(name, reg.machines[name], { orch: target, check: Boolean(flags.check), wait: Boolean(flags.wait) });
      } catch (e) {
        // upgradeMachine reports its own failures; this only keeps a seam bug from losing the --json summary
        r = { machine: name, status: 'failed', from: null, to: null, step: 'error', detail: String(e && e.message).split('\n')[0].slice(0, 200), fix: `run \`rig-remote doctor ${name}\`` };
      }
    }
    results.push(r);
    if (!flags.json) process.stdout.write(`${formatResult(r)}\n`);
  }
  if (flags.json) process.stdout.write(`${JSON.stringify({ orchestrator: target.version, check: Boolean(flags.check), results })}\n`);
  return results.some((r) => r.status === 'failed' || r.status === 'skipped') ? EXIT.ERROR : EXIT.OK;
}

module.exports = { run, formatResult };
