'use strict';
/**
 * Ordered phase -> machine map built from plan.md's phase table (shared
 * parser) plus each phase file's frontmatter (machine, owns, dependsOn,
 * reviewedSha). All values are validated: a plan dir may be restored from an
 * untrusted coord branch.
 */
const fs = require('fs');
const path = require('path');
const { parsePlanPhases } = require('../../../_shared/lib/plan-table-parser.cjs');
const { parseFrontmatter } = require('./plan-frontmatter.cjs');
const { RemoteError, EXIT, usageError } = require('./remote-errors.cjs');
const V = require('./identifier-validators.cjs');

const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((s) => String(s).trim()).filter(Boolean);
const pad2 = (s) => (/^\d$/.test(s) ? `0${s}` : s);

/** Build one entry from a table row; `file` must live inside planDir. */
function entryFor(row, planDir) {
  const file = row.file;
  const inside = file && path.relative(planDir, file) && !path.relative(planDir, file).startsWith('..') && !path.isAbsolute(path.relative(planDir, file));
  if (!inside) throw usageError(`phase ${row.phaseId}: file ${JSON.stringify(file)} is outside the plan dir`);
  if (/[a-z]$/i.test(row.phaseId)) throw usageError(`phase ${row.phaseId}: lettered phase ids are not supported for remote plans`);
  const phase = V.assertPhaseId(String(row.phase).padStart(2, '0'), 'phase id');
  let fm = {};
  try { fm = parseFrontmatter(fs.readFileSync(file, 'utf8')); } catch (e) {
    throw new RemoteError(`cannot read ${file}: ${e.code || e.message}`, EXIT.ERROR, { class: 'phase-unreadable' });
  }
  const machine = fm.machine ? V.assertMachineName(String(fm.machine), `phase ${phase} machine`) : null;
  const owns = asList(fm.owns);
  const dependsOn = asList(fm.dependsOn).map((d) => V.assertPhaseId(pad2(d), `phase ${phase} dependsOn`));
  const reviewedSha = fm.reviewedSha ? V.assertSha(String(fm.reviewedSha), `phase ${phase} reviewedSha`) : null;
  return { phase, name: row.name, file, status: row.status, machine, owns, dependsOn, reviewedSha };
}

/** @returns {Array<{phase, name, file, status, machine, owns, dependsOn, reviewedSha}>} in plan order */
function buildPhaseMap(planDir) {
  const dir = path.resolve(planDir);
  let text;
  try { text = fs.readFileSync(path.join(dir, 'plan.md'), 'utf8'); } catch (e) {
    throw new RemoteError(`${dir}/plan.md unreadable: ${e.code || e.message}`, EXIT.USAGE, { class: 'plan-missing' });
  }
  const rows = parsePlanPhases(text, dir).filter((r) => r.file);
  const map = rows.map((r) => entryFor(r, dir)).sort((a, b) => a.phase.localeCompare(b.phase));
  const seen = new Set();
  for (const e of map) {
    if (seen.has(e.phase)) throw usageError(`duplicate phase ${e.phase} in plan table`);
    seen.add(e.phase);
  }
  return map;
}

/** Machines in order of their first phase (remote phases only). */
const machineOrder = (map) => [...new Set(map.filter((e) => e.machine).map((e) => e.machine))];

/** exit 2 naming phases when a machine's phases are interleaved with another machine's. */
function assertSameMachineContiguous(map) {
  const remote = map.filter((e) => e.machine);
  const closed = new Set();
  let prev = null;
  for (const e of remote) {
    if (e.machine !== prev) {
      if (closed.has(e.machine)) {
        const phases = remote.filter((x) => x.machine === e.machine).map((x) => x.phase).join(', ');
        throw usageError(`machine ${e.machine} phases (${phases}) are not contiguous: another machine's phase sits between them`, 'reorder phases or split the plan so one machine owns a contiguous block');
      }
      if (prev) closed.add(prev);
      prev = e.machine;
    }
  }
  return true;
}

/** Union of `owns` globs of all phases assigned to `machine` (deduplicated, plan order). */
const ownsUnion = (map, machine) => [...new Set(map.filter((e) => e.machine === machine).flatMap((e) => e.owns))];

module.exports = { buildPhaseMap, machineOrder, assertSameMachineContiguous, ownsUnion };
