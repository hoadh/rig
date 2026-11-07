'use strict';
/**
 * After a takeover, find runs the OLD orchestrator left in flight by asking
 * every registry machine (`worker list`). Run truth lives on the workers; there
 * is no orchestrator-side ledger. Unreachable machines are reported `unknown`.
 */

const IN_FLIGHT = new Set(['starting', 'running', 'cancelling']);

/** Pure filter over a worker `list` reply's runs. */
function filterInflight(runs, oldOrchestrator, slug) {
  return (Array.isArray(runs) ? runs : []).filter((r) => r && r.orchestrator === oldOrchestrator && r.slug === slug && IN_FLIGHT.has(r.state));
}

/**
 * @param {{machines: string[], slug: string, oldOrchestrator: string,
 *          listRuns: (machine: string) => Promise<{runs: object[]}>}} p
 * @returns {Promise<{inflight: Array<{machine:string, runId:string, state:string, phase:*}>, unknown: Array<{machine:string, reason:string}>}>}
 */
async function scanInflightRuns({ machines, slug, oldOrchestrator, listRuns }) {
  const results = await Promise.all(machines.map(async (machine) => {
    try {
      const reply = await listRuns(machine);
      return { machine, runs: filterInflight(reply && reply.runs, oldOrchestrator, slug) };
    } catch (e) {
      return { machine, error: String((e && e.message) || e).split('\n')[0] };
    }
  }));
  const inflight = [], unknown = [];
  for (const r of results) {
    if (r.error !== undefined) unknown.push({ machine: r.machine, reason: r.error });
    else for (const run of r.runs) inflight.push({ machine: r.machine, runId: run.runId, state: run.state, phase: run.phase === undefined ? null : run.phase });
  }
  return { inflight, unknown };
}

module.exports = { filterInflight, scanInflightRuns, IN_FLIGHT };
