'use strict';
/**
 * machines [--json]: list this machine's id and the registry machines (id, os, shell, allowedTools).
 * Local read only, no ssh: lets /rig:plan offer real machine ids before asking the user to assign phases.
 * A missing registry is not an error (prints none, exit 0); an invalid one still fails with exit 2.
 */
const { EXIT, RemoteError, usageError } = require('../lib/remote-errors.cjs');
const { parseFlags } = require('../lib/cli-flag-parser.cjs');
const { loadRegistry, registryPath } = require('../lib/machine-registry.cjs');

/** Registry machines as summaries: ssh/repo/node/claude/pathPrepend are dropped; allowedTools is passed through verbatim. */
function listMachines() {
  try {
    const reg = loadRegistry();
    const machines = Object.values(reg.machines).map((m) => ({
      id: m.name, os: m.os, shell: m.shell, allowedTools: m.allowedTools || [],
    }));
    return { registry: reg.path, found: true, machines };
  } catch (e) {
    if (e instanceof RemoteError && e.class === 'registry-missing') return { registry: registryPath(), found: false, machines: [] };
    throw e;
  }
}

async function run(argv, ctx) {
  const { flags, positional } = parseFlags(argv, { '--json': 'bool' });
  if (positional.length) throw usageError('usage: machines [--json]');
  const { registry, found, machines } = listMachines();
  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ self: ctx.self, registry, found, machines })}\n`);
    return EXIT.OK;
  }
  const lines = [`self: ${ctx.self}`, `registry: ${found ? registry : `(none at ${registry})`}`];
  for (const m of machines) {
    const self = m.id === ctx.self ? ' (this machine)' : '';
    const tools = m.allowedTools.length ? ` tools: ${m.allowedTools.join(' ')}` : '';
    lines.push(`  ${m.id}${self}  ${m.os}/${m.shell}${tools}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
  return EXIT.OK;
}

module.exports = { run, listMachines };
