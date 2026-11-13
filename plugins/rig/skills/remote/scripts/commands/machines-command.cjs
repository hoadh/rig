'use strict';
/**
 * machines [--json]: list this machine's id and the registry machines (id, os, shell, allowedTools,
 * hasClone: whether the machine has a clone of the project in cwd; null when cwd has no origin).
 * Local read only, no ssh: lets /rig:plan offer real machine ids before asking the user to assign phases.
 * A missing registry is not an error (prints none, exit 0); an invalid one still fails with exit 2.
 */
const { EXIT, RemoteError, usageError } = require('../lib/remote-errors.cjs');
const { parseFlags } = require('../lib/cli-flag-parser.cjs');
const { loadRegistry, registryPath } = require('../lib/machine-registry.cjs');
const { readRigVersion, SEMVER } = require('../lib/rig-version-compat.cjs');
const { execWorker } = require('../lib/ssh-transport.cjs');
const { projectOriginUrl, hasCloneForProject } = require('../lib/machine-repo-for-project-resolver.cjs');

/** Registry machines as summaries: ssh/repo/repos/node/claude/pathPrepend are dropped; allowedTools is passed through verbatim. */
function listMachines(cwd = process.cwd()) {
  try {
    const reg = loadRegistry();
    const origin = projectOriginUrl(cwd);
    const machines = Object.values(reg.machines).map((m) => ({
      id: m.name, os: m.os, shell: m.shell, allowedTools: m.allowedTools || [], hasClone: hasCloneForProject(m, origin),
    }));
    return { registry: reg.path, found: true, machines };
  } catch (e) {
    if (e instanceof RemoteError && e.class === 'registry-missing') return { registry: registryPath(), found: false, machines: [] };
    throw e;
  }
}

const PROBE_TIMEOUT_MS = 5_000;

/** Probe classes that mean "answered, but no usable Rig runtime" (not the same as unreachable). */
const NO_RUNTIME_CLASSES = new Set(['worker-missing', 'command-not-found', 'protocol-mismatch', 'version-mismatch', 'version-unknown', 'runtime-incomplete', 'worker-error']);

/**
 * Worker Rig version by one `info` call.
 * @returns {Promise<{version: string|null, probe: 'ok'|'no-runtime'|'unreachable'}>}
 */
async function probeRigVersion(id, timeoutMs = PROBE_TIMEOUT_MS) {
  try {
    const { reply } = await execWorker(id, 'info', [], { timeoutMs });
    if (reply && typeof reply.rigVersion === 'string' && SEMVER.test(reply.rigVersion)) return { version: reply.rigVersion, probe: 'ok' };
    return { version: null, probe: 'no-runtime' };
  } catch (e) {
    return { version: null, probe: e && NO_RUNTIME_CLASSES.has(e.class) ? 'no-runtime' : 'unreachable' };
  }
}

/** Adds `rigVersion` and `rigProbe` to every machine (parallel probes; this machine reads its own version, no ssh). */
async function withRigVersions(machines, self, probe = probeRigVersion) {
  return Promise.all(machines.map(async (m) => {
    const r = m.id === self ? { version: readRigVersion(), probe: 'ok' } : await probe(m.id);
    return { ...m, rigVersion: r.version, rigProbe: r.probe };
  }));
}

async function run(argv, ctx) {
  const { flags, positional } = parseFlags(argv, { '--json': 'bool', '--offline': 'bool' });
  if (positional.length) throw usageError('usage: machines [--json] [--offline]');
  const listed = listMachines();
  const { registry, found } = listed;
  const machines = flags.offline ? listed.machines : await withRigVersions(listed.machines, ctx.self);
  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ self: ctx.self, registry, found, machines })}\n`);
    return EXIT.OK;
  }
  const lines = [`self: ${ctx.self}`, `registry: ${found ? registry : `(none at ${registry})`}`];
  for (const m of machines) {
    const self = m.id === ctx.self ? ' (this machine)' : '';
    const tools = m.allowedTools.length ? ` tools: ${m.allowedTools.join(' ')}` : '';
    const clone = m.hasClone === false ? ' (no clone for this project)' : '';
    const ver = flags.offline ? '' : ` Rig ${m.rigVersion || (m.rigProbe === 'no-runtime' ? 'unknown (no Rig runtime)' : 'unreachable')}`;
    lines.push(`  ${m.id}${self}  ${m.os}/${m.shell}${ver}${tools}${clone}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
  return EXIT.OK;
}

module.exports = { run, listMachines, withRigVersions, probeRigVersion };
