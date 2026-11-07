'use strict';
/**
 * collect <plan-dir> [--test <machine>=<cmd>]... [--allow-missing]
 * Merges reviewed worker branches into rig-int/<slug> (plan order), pushes,
 * then optionally runs per-machine test commands against the integration sha.
 * Exit: 0 ok | 1 refused or tests failed | 3 lock | 4 merge conflict.
 * Tests only start after every branch is reviewed AND merged. Test output is
 * untrusted and goes to reports/collect-<sha7>.md.
 */
const fs = require('fs');
const path = require('path');
const { RemoteError, EXIT, usageError } = require('../lib/remote-errors.cjs');
const { parseFlags } = require('../lib/cli-flag-parser.cjs');
const V = require('../lib/identifier-validators.cjs');
const { getMachineForProject } = require('../lib/machine-repo-for-project-resolver.cjs');
const { parseFrontmatter } = require('../lib/plan-frontmatter.cjs');
const { workerBranch, integrationBranch } = require('../lib/rig-branch-and-path-names.cjs');
const { git, gitOrThrow } = require('../lib/rig-local-worktree.cjs');
const { newRunId } = require('../lib/run-directory.cjs');
const { assertOrchestrator, syncCoord, slugOf } = require('../lib/orchestrator-lock.cjs');
const { buildPhaseMap, assertSameMachineContiguous, machineOrder } = require('../lib/plan-phase-machine-map.cjs');
const { planBranchOf, lsRemoteHead } = require('../lib/dispatch-base-resolver.cjs');
const { snapshotPlanRuns, activeRuns, unreachable } = require('../lib/plan-run-tracker.cjs');
const { preflightMachine } = require('../lib/collect-preflight-checks.cjs');
const { mergeIntoIntegration } = require('../lib/integration-branch-merger.cjs');
const { writeCollectReport } = require('../lib/untrusted-run-report-writer.cjs');

const TEST_TIMEOUT_SEC = 1800;
const USAGE = 'usage: collect <plan-dir> [--test <machine>=<cmd>]... [--allow-missing]';

/** parseFlags rejects repeated flags, so pull every `--test m=cmd` out first. */
function extractTests(argv) {
  const rest = [];
  const tests = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--test') { rest.push(argv[i]); continue; }
    const v = argv[++i] || '';
    const eq = v.indexOf('=');
    if (eq < 1 || eq === v.length - 1) throw usageError(`--test needs <machine>=<command>, got ${JSON.stringify(v)}`);
    tests.push({ machine: V.assertMachineName(v.slice(0, eq), '--test machine'), command: v.slice(eq + 1) });
  }
  return { rest, tests };
}

async function runTests(client, { slug, intSha, self, tests }) {
  const started = await Promise.all(tests.map(async (tt) => {
    const spec = { v: 1, runId: newRunId(), orchestrator: self, slug, phase: null, kind: 'command', ref: intSha, command: tt.command, timeoutSec: TEST_TIMEOUT_SEC };
    const { runId } = await client.startRun(tt.machine, spec, '');
    return { ...tt, runId };
  }));
  return Promise.all(started.map(async (s) => {
    const st = await client.waitForRun(s.machine, s.runId, { maxMs: (TEST_TIMEOUT_SEC + 120) * 1000 });
    return { machine: s.machine, state: st.state, exit: st.exit, logTail: st.logTail || '' };
  }));
}

async function run(argv, ctx) {
  const self = V.assertMachineName(ctx.self, 'self machine id');
  const client = ctx.client || require('../lib/orchestrator-run-client.cjs');
  const ensureCompatible = ctx.ensureCompatible || require('../lib/ssh-transport.cjs').ensureWorkerCompatible;
  const { rest, tests } = extractTests(argv);
  const { flags, positional } = parseFlags(rest, { '--allow-missing': 'bool' });
  if (positional.length !== 1) throw usageError(USAGE);
  const planDir = path.resolve(positional[0]);
  const slug = slugOf(planDir);
  const map = buildPhaseMap(planDir);
  assertSameMachineContiguous(map);
  const machines = machineOrder(map).filter((m) => m !== self);
  if (!machines.length) throw usageError('plan has no remote-machine phases to collect');
  for (const tt of tests) getMachineForProject(tt.machine); // unknown machine or no clone for this project -> usage error before any side effect
  await Promise.all([...new Set([...machines, ...tests.map((x) => x.machine)])].map((m) => ensureCompatible(m)));

  const repo = gitOrThrow(process.cwd(), ['rev-parse', '--show-toplevel']);
  assertOrchestrator(repo, planDir, self);
  syncCoord(repo, planDir, self);

  const snap = await snapshotPlanRuns(planDir, client);
  const bad = unreachable(snap);
  if (bad.length) throw new RemoteError(`cannot verify runs, machine unreachable: ${bad.map((m) => m.machine).join(', ')}`, EXIT.ERROR, { class: 'unreachable', hint: 'run doctor; collect fails closed' });
  const act = activeRuns(snap);
  if (act.length) throw new RemoteError(`runs still active: ${act.map((r) => `${r.machine}:${r.runId}`).join(', ')}`, EXIT.ERROR, { class: 'runs-active', hint: `status ${planDir} --wait` });

  const planBranch = planBranchOf(parseFrontmatter(fs.readFileSync(path.join(planDir, 'plan.md'), 'utf8')));
  const planSha = lsRemoteHead(repo, planBranch);
  if (!planSha) throw new RemoteError(`plan branch ${planBranch} missing on origin`, EXIT.ERROR, { class: 'plan-branch-missing' });
  gitOrThrow(repo, ['fetch', '-q', 'origin', `+refs/heads/${planBranch}:refs/remotes/origin/${planBranch}`, '+refs/heads/rig/*:refs/remotes/origin/rig/*'], { timeoutMs: 180000 });
  const intRemote = lsRemoteHead(repo, integrationBranch(slug));
  if (intRemote) gitOrThrow(repo, ['fetch', '-q', 'origin', `+refs/heads/${integrationBranch(slug)}:refs/remotes/origin/${integrationBranch(slug)}`]);

  const branches = [];
  for (const m of machines) {
    const r = git(repo, ['rev-parse', '--verify', '-q', `refs/remotes/origin/${workerBranch(m, slug)}^{commit}`]);
    if (r.status !== 0) {
      if (flags['allow-missing']) { process.stderr.write(`warn: ${workerBranch(m, slug)} missing on origin; skipped (--allow-missing)\n`); continue; }
      throw new RemoteError(`worker branch ${workerBranch(m, slug)} not on origin`, EXIT.ERROR, { class: 'branch-missing', hint: 'dispatch it, or pass --allow-missing' });
    }
    branches.push({ machine: m, sha: String(r.stdout).trim() });
  }
  for (const b of branches) preflightMachine({ repo, map, machine: b.machine, headSha: b.sha, baseCandidateSha: intRemote || planSha });

  const merge = mergeIntoIntegration({ repo, slug, planSha, branches });
  process.stdout.write(`${integrationBranch(slug)} @ ${merge.intSha.slice(0, 8)} merged=[${merge.merged}] already=[${merge.skipped}]${merge.pushed ? ' pushed' : ''}\n`);
  if (!tests.length) return EXIT.OK;

  const results = await runTests(client, { slug, intSha: merge.intSha, self, tests });
  const report = writeCollectReport(planDir, { intSha: merge.intSha, merged: [...merge.merged, ...merge.skipped.map((m) => `${m} (already merged)`)], tests: results });
  for (const r of results) process.stdout.write(`test ${r.machine}: ${r.state} exit=${r.exit}\n`);
  process.stdout.write(`report: ${report}\n`);
  return results.every((r) => r.state === 'done' && r.exit === 0) ? EXIT.OK : EXIT.ERROR;
}

module.exports = { run, extractTests };
