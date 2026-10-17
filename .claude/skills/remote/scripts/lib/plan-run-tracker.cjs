'use strict';
/**
 * Plan-level view of worker runs: per plan machine `list --slug`, active-run
 * detection, latest run per phase, and local report generation for finished
 * runs. An unreachable machine is reported (never silently treated as idle).
 */
const { buildPhaseMap, machineOrder } = require('./plan-phase-machine-map.cjs');
const { slugOf } = require('./orchestrator-lock.cjs');
const { writeRunReport } = require('./untrusted-run-report-writer.cjs');

const ACTIVE = new Set(['starting', 'running', 'cancelling']);
const FINISHED = new Set(['done', 'failed', 'lost']);

/** @returns {Promise<{slug, machines: Array<{machine, runs, error}>}>} */
async function snapshotPlanRuns(planDir, client) {
  const slug = slugOf(planDir);
  const names = machineOrder(buildPhaseMap(planDir));
  const machines = await Promise.all(names.map(async (machine) => {
    try { return { machine, runs: await client.fetchRunList(machine, slug), error: null }; }
    catch (e) { return { machine, runs: [], error: e.message }; }
  }));
  return { slug, machines };
}

const activeRuns = (snap) => snap.machines.flatMap((m) => m.runs.filter((r) => ACTIVE.has(r.state)).map((r) => ({ ...r, machine: m.machine })));
const unreachable = (snap) => snap.machines.filter((m) => m.error);

/** Latest run (list order = oldest first) per machine for phase `phase`. */
const latestRunForPhase = (snap, machine, phase) => {
  const m = snap.machines.find((x) => x.machine === machine);
  return m ? m.runs.filter((r) => String(r.phase) === String(phase)).pop() || null : null;
};

/** Writes reports for finished runs that have none yet. @returns {Promise<string[]>} new report paths */
async function ensureReports(planDir, snap, client) {
  const written = [];
  for (const m of snap.machines) {
    for (const r of m.runs.filter((x) => FINISHED.has(x.state) && x.kind === 'agent')) {
      const st = await client.fetchRunStatus(m.machine, r.runId);
      const f = writeRunReport(planDir, st, m.machine);
      if (f) written.push(f);
    }
  }
  return written;
}

const hasFailure = (snap) => snap.machines.some((m) => m.runs.some((r) => r.state === 'failed' || r.state === 'lost')) || unreachable(snap).length > 0;

function formatSnapshot(snap) {
  const out = [`plan ${snap.slug}`];
  for (const m of snap.machines) {
    if (m.error) { out.push(`  ${m.machine}: UNREACHABLE ${m.error}`); continue; }
    if (!m.runs.length) out.push(`  ${m.machine}: no runs`);
    for (const r of m.runs) out.push(`  ${m.machine}: phase ${r.phase ?? '-'} ${r.kind} ${r.runId} ${r.state}${r.failure ? `:${r.failure}` : ''} exit=${r.exit ?? '-'} head=${(r.head || '-').slice(0, 8)} pushed=${r.pushed ?? '-'}`);
  }
  return `${out.join('\n')}\n`;
}

module.exports = { snapshotPlanRuns, activeRuns, unreachable, latestRunForPhase, ensureReports, hasFailure, formatSnapshot, ACTIVE };
