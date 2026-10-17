'use strict';
/**
 * `status <machine> <runId> [--wait] [--json]` (run mode) or `status <plan-dir> [--wait] [--json]` (plan mode).
 * One ssh per poll. Exit: 0 running/done, 1 failed/lost.
 */
const { usageError, EXIT } = require('../lib/remote-errors.cjs');
const { parseFlags } = require('../lib/cli-flag-parser.cjs');
const V = require('../lib/identifier-validators.cjs');
const client = require('../lib/orchestrator-run-client.cjs');
const defaultClient = client;
const fs = require('fs');
const path = require('path');
const { assertOrchestrator } = require('../lib/orchestrator-lock.cjs');
const { gitOrThrow } = require('../lib/rig-local-worktree.cjs');
const tracker = require('../lib/plan-run-tracker.cjs');

function formatStatus(st) {
  const age = st.heartbeatAt ? `${Math.round((Date.now() - st.heartbeatAt) / 1000)}s ago` : 'none';
  const lines = [`${st.runId} ${st.state}${st.failure ? `:${st.failure}` : ''} exit=${st.exit ?? '-'} heartbeat=${age} head=${st.head || '-'} pushed=${st.pushed ?? '-'}`];
  if (st.state === 'lost') lines.push('note: no heartbeat for >90s (machine asleep or runner killed); re-dispatch with a new runId if needed');
  if (st.failure === 'not-started') lines.push('hint: interactive taskMode needs a logged-on user; use taskMode headless');
  if (st.logTail) lines.push('--- log tail ---', st.logTail);
  return `${lines.join('\n')}\n`;
}

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/** Plan mode: all runs of the plan's machines; read-only on coord (assertOrchestrator only). */
async function runPlanMode(planDir, flags, ctx) {
  const client = ctx.client || defaultClient;
  const repo = gitOrThrow(process.cwd(), ['rev-parse', '--show-toplevel']);
  assertOrchestrator(repo, planDir, V.assertMachineName(ctx.self, 'self machine id'));
  let snap = await tracker.snapshotPlanRuns(planDir, client);
  while (flags.wait && tracker.activeRuns(snap).length) {
    await new Promise((r) => setTimeout(r, Number(process.env.RIG_STATUS_POLL_MS) || 3000));
    snap = await tracker.snapshotPlanRuns(planDir, client);
  }
  const reports = await tracker.ensureReports(planDir, snap, client);
  process.stdout.write(flags.json ? `${JSON.stringify({ ...snap, reports })}\n` : tracker.formatSnapshot(snap) + reports.map((f) => `report: ${f}\n`).join(''));
  return tracker.hasFailure(snap) ? EXIT.ERROR : EXIT.OK;
}

async function run(argv, ctx = {}) {
  const { flags, positional } = parseFlags(argv, { '--wait': 'bool', '--json': 'bool' });
  if (positional.length === 1 && isDir(positional[0])) return runPlanMode(path.resolve(positional[0]), flags, ctx);
  if (positional.length !== 2) throw usageError('usage: status <plan-dir> | <machine> <runId> [--wait] [--json]');
  const machine = V.assertMachineName(positional[0], 'machine');
  const runId = V.assertRunId(positional[1]);
  const st = flags.wait ? await client.waitForRun(machine, runId) : await client.fetchRunStatus(machine, runId);
  process.stdout.write(flags.json ? `${JSON.stringify(st)}\n` : formatStatus(st));
  return st.state === 'failed' || st.state === 'lost' ? EXIT.ERROR : EXIT.OK;
}

module.exports = { run, formatStatus };
