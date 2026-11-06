'use strict';
/**
 * Rig version of this install and the orchestrator/worker compatibility rule.
 *
 * Where the version comes from (first hit wins):
 *   1. `<runtime>/VERSION`            the worker runtime copy (~/.claude/rig/runtime), stamped last by the copy
 *   2. `<root>/.claude-plugin/plugin.json`   a plugin install or a repo checkout
 *   3. `<root>/metadata.json`         a 1.x-style file install (written by the installer)
 * Orchestrator and worker must agree on the protocol AND the major version; anything else is refused
 * with a hint saying how to install Rig on the worker.
 */
const fs = require('fs');
const path = require('path');

const SEMVER = /^(\d+)\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/;

// lib dir -> runtime root (runtime/remote/lib) and -> plugin / .claude root (skills/remote/scripts/lib)
const RUNTIME_ROOT = path.resolve(__dirname, '..', '..');
const KIT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

const WORKER_INSTALL_HINT = 'install the Rig plugin on the worker and start one Claude Code session there (or run `rig-init --runtime` in a terminal there) so ~/.claude/rig/runtime exists; ' +
  'orchestrator and worker need the same major Rig version';

function readVersionFile(file, parse) {
  try {
    const v = parse(fs.readFileSync(file, 'utf8'));
    return typeof v === 'string' && SEMVER.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** @param {string} [root] one explicit root (tests, installers); default: the runtime root, then the kit root */
function readRigVersion(root) {
  for (const r of root ? [root] : [RUNTIME_ROOT, KIT_ROOT]) {
    const v = readVersionFile(path.join(r, 'VERSION'), (t) => t.trim())
      || readVersionFile(path.join(r, '.claude-plugin', 'plugin.json'), (t) => JSON.parse(t).version)
      || readVersionFile(path.join(r, 'metadata.json'), (t) => JSON.parse(t).version);
    if (v) return v;
  }
  return 'unknown';
}

/** Major number of a version string, or null when it is not a version (`unknown`, garbage). */
function majorOf(version) {
  const m = SEMVER.exec(String(version));
  return m ? Number(m[1]) : null;
}

/**
 * Do two Rig versions agree on the major number? (Minor and patch drift is only a warning elsewhere.)
 * @returns {null | {cls: string, message: string}} null = same major
 */
function checkVersionCompat(workerVersion, orchestratorVersion) {
  const wMajor = majorOf(workerVersion);
  const oMajor = majorOf(orchestratorVersion);
  if (wMajor === null || oMajor === null) return { cls: 'version-unknown', message: `Rig version unknown (worker ${workerVersion}, orchestrator ${orchestratorVersion})` };
  if (wMajor !== oMajor) return { cls: 'version-mismatch', message: `Rig major version ${workerVersion} != orchestrator ${orchestratorVersion}` };
  return null;
}

/**
 * Is a worker usable by this orchestrator? Protocol first, then the Rig major version.
 * @returns {null | {cls: string, message: string, hint: string}} null = compatible
 */
function checkWorkerCompat(worker, orch) {
  if (worker.protocol !== orch.protocol) {
    return { cls: 'protocol-mismatch', message: `protocol ${worker.protocol} != orchestrator ${orch.protocol}`, hint: WORKER_INSTALL_HINT };
  }
  const refused = checkVersionCompat(worker.rigVersion, orch.rigVersion);
  return refused && { ...refused, hint: WORKER_INSTALL_HINT };
}

/**
 * Worker side, fail closed: a worker started from the runtime copy without a valid VERSION is an incomplete or
 * half-replaced copy. `dir` is the runtime root (the worker's parent dir).
 * @returns {string|null} problem text, or null (not a runtime copy, or complete)
 */
function runtimeVersionProblem(dir) {
  const isRuntime = path.basename(dir) === 'runtime' && path.basename(path.dirname(dir)) === 'rig';
  if (!isRuntime) return null;
  return readVersionFile(path.join(dir, 'VERSION'), (t) => t.trim()) ? null : `Rig runtime copy at ${dir} has no valid VERSION (incomplete or being replaced)`;
}

module.exports = { readRigVersion, majorOf, checkVersionCompat, checkWorkerCompat, runtimeVersionProblem, WORKER_INSTALL_HINT, SEMVER };
