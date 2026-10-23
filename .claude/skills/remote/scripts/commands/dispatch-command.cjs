'use strict';
/**
 * dispatch <plan-dir> <phase-file> [--resume --message-file f] [--max-turns n] [--allowed-tools "A B"] [--settings <abs path on worker>]
 * Starts the phase's agent run on its machine at an immutable base SHA.
 * Exit: 0 started | 1 refused (push first, collect first, agent active) | 2 usage/policy | 3 lock.
 * `ctx.client` / `ctx.ensureCompatible` are test seams (default: real worker protocol).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { RemoteError, EXIT, usageError } = require('../lib/remote-errors.cjs');
const { parseFlags } = require('../lib/cli-flag-parser.cjs');
const V = require('../lib/identifier-validators.cjs');
const { getMachineForProject } = require('../lib/machine-repo-for-project-resolver.cjs');
const { parseFrontmatter } = require('../lib/plan-frontmatter.cjs');
const { workerBranch } = require('../lib/rig-branch-and-path-names.cjs');
const { gitOrThrow } = require('../lib/rig-local-worktree.cjs');
const { newRunId } = require('../lib/run-directory.cjs');
const { assertOrchestrator, syncCoord, slugOf } = require('../lib/orchestrator-lock.cjs');
const { resolveAllowedTools, ALWAYS_DISALLOWED } = require('../lib/allowed-tools-policy.cjs');
const { buildPhaseMap, assertSameMachineContiguous, ownsUnion } = require('../lib/plan-phase-machine-map.cjs');
const { planBranchOf, resolveDispatchBase } = require('../lib/dispatch-base-resolver.cjs');
const { composeTask } = require('../lib/dispatch-task-composer.cjs');
const { markPhaseInProgress } = require('../lib/plan-phase-status-writer.cjs');

const DEFAULT_MAX_TURNS = 150;
const AGENT_TIMEOUT_SEC = 7200;
const ACTIVE = new Set(['starting', 'running', 'cancelling']);
const USAGE = 'usage: dispatch <plan-dir> <phase-file> [--resume --message-file f] [--max-turns n] [--allowed-tools "A B"] [--settings <abs path>]';

function parseArgs(argv) {
  const { flags, positional } = parseFlags(argv, { '--resume': 'bool', '--message-file': 'value', '--max-turns': 'value', '--allowed-tools': 'value', '--settings': 'value' });
  if (positional.length !== 2) throw usageError(USAGE);
  if (Boolean(flags.resume) !== Boolean(flags['message-file'])) throw usageError('--resume and --message-file go together');
  const maxTurns = flags['max-turns'] === undefined ? DEFAULT_MAX_TURNS : Number(flags['max-turns']);
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 1000) throw usageError('--max-turns must be an integer 1..1000');
  return { planDir: path.resolve(positional[0]), phaseArg: positional[1], resume: !!flags.resume, messageFile: flags['message-file'], maxTurns, allowedTools: flags['allowed-tools'] ?? null, settings: flags.settings ?? null };
}

function findPhase(map, planDir, phaseArg) {
  const candidates = [path.resolve(phaseArg), path.resolve(planDir, phaseArg)];
  const entry = map.find((e) => candidates.includes(e.file));
  if (!entry) throw usageError(`${phaseArg} is not a phase of ${planDir}/plan.md`);
  return entry;
}

function readMessage(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (!text.trim() || Buffer.byteLength(text) > 1024 * 1024) throw usageError('--message-file must be non-empty and <= 1 MB');
  return text;
}

/** Test commands hinted to the agent: registry `Bash(<cmd>:*)` entries that are not git. */
const testHintOf = (machine) => (machine.allowedTools || []).map((t) => /^Bash\((.+?)(?::\*)?\)$/.exec(t)).filter((m) => m && !m[1].startsWith('git ')).map((m) => m[1]).join(', ');

/**
 * Session of the newest phase run that has one. Runs that never reached claude
 * (not-started, prepare/lock/auth failures) carry no session and are skipped, so they
 * cannot hide the earlier session a correction round must resume. `runs` is oldest-first.
 */
async function latestSessionId(client, machine, runs) {
  for (const r of [...runs].reverse()) {
    const st = await client.fetchRunStatus(machine, r.runId);
    const sid = st && st.result && st.result.claude && st.result.claude.session_id;
    if (sid) return sid;
  }
  return null;
}

async function run(argv, ctx) {
  const self = V.assertMachineName(ctx.self, 'self machine id');
  const client = ctx.client || require('../lib/orchestrator-run-client.cjs');
  const ensureCompatible = ctx.ensureCompatible || require('../lib/ssh-transport.cjs').ensureWorkerCompatible;
  const args = parseArgs(argv);
  const slug = slugOf(args.planDir);
  const map = buildPhaseMap(args.planDir);
  const entry = findPhase(map, args.planDir, args.phaseArg);
  if (!entry.machine) throw usageError(`phase ${entry.phase} has no machine; run it locally`);
  if (entry.machine === self) throw usageError(`phase ${entry.phase} targets this machine (${self}); run it locally`);
  if (!entry.owns.length) throw usageError(`phase ${entry.phase} needs a non-empty "owns:" list in its frontmatter`);
  assertSameMachineContiguous(map);
  const machine = getMachineForProject(entry.machine);
  const allowedTools = resolveAllowedTools(args.allowedTools, machine.allowedTools || []);
  const message = args.resume ? readMessage(args.messageFile) : null;
  await ensureCompatible(entry.machine);

  const repo = gitOrThrow(process.cwd(), ['rev-parse', '--show-toplevel']);
  assertOrchestrator(repo, args.planDir, self); // fail-closed (exit 3)
  const planFm = parseFrontmatter(fs.readFileSync(path.join(args.planDir, 'plan.md'), 'utf8'));
  const depMachines = entry.dependsOn.map((d) => (map.find((e) => e.phase === d) || {}).machine).filter(Boolean);
  const base = resolveDispatchBase({ repo, slug, self, machine: entry.machine, planBranch: planBranchOf(planFm), dependsOnMachines: depMachines });

  const runs = await client.fetchRunList(entry.machine, slug);
  const active = runs.find((r) => r.kind === 'agent' && ACTIVE.has(r.state));
  if (active) throw new RemoteError(`${entry.machine} already has an active agent run ${active.runId} (${active.state})`, EXIT.ERROR, { class: 'agent-active', hint: `status ${args.planDir} --wait, or cancel ${entry.machine} ${active.runId}` });
  let sessionId = crypto.randomUUID();
  if (args.resume) {
    const sid = await latestSessionId(client, entry.machine, runs.filter((r) => r.kind === 'agent' && String(r.phase) === entry.phase));
    if (!sid) throw new RemoteError(`no earlier agent session found for phase ${entry.phase} on ${entry.machine}`, EXIT.ERROR, { class: 'no-session', hint: 'dispatch without --resume' });
    sessionId = sid;
  }
  const branch = workerBranch(entry.machine, slug);
  const spec = {
    v: 1, runId: newRunId(), orchestrator: self, slug, phase: entry.phase, kind: 'agent', baseSha: base.baseSha, startSha: base.startSha, branch,
    owns: ownsUnion(map, entry.machine), timeoutSec: AGENT_TIMEOUT_SEC, maxTurns: args.maxTurns,
    agent: { sessionId, resume: args.resume, allowedTools, disallowedTools: ALWAYS_DISALLOWED, ...(args.settings ? { settings: args.settings } : {}) },
  };
  const task = message || composeTask({ slug, phase: entry.phase, machine: entry.machine, branch, baseSha: base.baseSha, owns: spec.owns, phaseText: fs.readFileSync(entry.file, 'utf8'), testHint: testHintOf(machine) });

  assertOrchestrator(repo, args.planDir, self); // re-check right before the side effect
  const started = await client.startRun(entry.machine, spec, task);
  if (!args.resume) markPhaseInProgress(args.planDir, entry.file);
  syncCoord(repo, args.planDir, self);
  process.stdout.write(`${started.runId} ${started.state} on ${entry.machine} (${started.method}) base=${base.baseSha.slice(0, 8)} start=${base.startSha.slice(0, 8)}\nwait: status ${args.planDir} --wait\n`);
  return EXIT.OK;
}

module.exports = { run };
