/**
 * Rig-vs-vanilla benchmark runner. Sequential, resumable by (arm, task, run), hard cost cap.
 *
 *   node scripts/benchmark/run-benchmark.ts --arm both --task all --runs 3 --budget 100
 *   node scripts/benchmark/run-benchmark.ts --arm both --task 2 --runs 1 --budget 10 --date dry-run
 *
 * Options: --arm vanilla|rig|both  --task N|all  --runs N  --budget USD (required, cumulative cap)
 *          --run-cap USD (per-run cap, default 8)  --timeout-min N (default 20)  --model M
 *          --date NAME (results dir name, default today)  --keep (keep temp workspaces)
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertIsolation, buildChildEnv, commitBaseline, createIsolatedConfigDir, installRig } from './benchmark-arm-setup.ts';
import { collectMetrics, parseClaudeResult } from './benchmark-metrics-collector.ts';
import type { ClaudeResult } from './benchmark-metrics-collector.ts';
import type { Arm, BenchmarkTask, RunMetrics } from './benchmark-types.ts';
import { BENCH_DIR, loadTasks, prepareWorkspace } from './benchmark-workspace.ts';

/** Same allowlist for both arms: run tests/scripts and read git state without prompts. */
const ALLOWED_TOOLS = 'Bash(npm test:*),Bash(npm run:*),Bash(node:*),Bash(git status:*),Bash(git diff:*),Bash(git log:*)';

interface Options {
  arms: Arm[];
  tasks: BenchmarkTask[];
  runs: number;
  budget: number;
  runCap: number;
  timeoutMin: number;
  model?: string;
  date: string;
  keep: boolean;
}

function parseOptions(argv: string[]): Options {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`Unexpected argument: ${a}`);
    const next = argv[i + 1];
    if (a === '--keep') flags.set('keep', 'true');
    else if (next === undefined || next.startsWith('--')) throw new Error(`${a} needs a value`);
    else flags.set(a.slice(2), argv[++i]);
  }
  const num = (name: string, fallback?: number): number => {
    const raw = flags.get(name);
    if (raw === undefined) {
      if (fallback === undefined) throw new Error(`--${name} is required`);
      return fallback;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} must be a positive number`);
    return n;
  };
  const armFlag = flags.get('arm') ?? 'both';
  if (!['vanilla', 'rig', 'both'].includes(armFlag)) throw new Error('--arm must be vanilla, rig or both');
  const all = loadTasks();
  const taskFlag = flags.get('task') ?? 'all';
  const tasks = taskFlag === 'all' ? all : all.filter((t) => String(t.id) === taskFlag);
  if (tasks.length === 0) throw new Error(`No task matches --task ${taskFlag}`);
  return {
    arms: armFlag === 'both' ? ['vanilla', 'rig'] : [armFlag as Arm],
    tasks,
    runs: num('runs', 1),
    budget: num('budget'),
    runCap: num('run-cap', 8),
    timeoutMin: num('timeout-min', 20),
    model: flags.get('model'),
    date: flags.get('date') ?? new Date().toISOString().slice(0, 10),
    keep: flags.has('keep'),
  };
}

function readDone(file: string): RunMetrics[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as RunMetrics);
}

function claudeVersion(): string {
  const res = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  return res.status === 0 ? res.stdout.trim() : 'unknown';
}

/** Runs one (arm, task, run) cell end to end and returns its metrics. */
function runOne(opts: Options, arm: Arm, task: BenchmarkTask, run: number, remainingBudget: number, version: string, rawDir: string): RunMetrics {
  const base = mkdtempSync(path.join(tmpdir(), `rig-bench-${arm}-t${task.id}-r${run}-`));
  const workspace = path.join(base, 'work');
  try {
    prepareWorkspace(workspace, task);
    if (arm === 'rig') installRig(workspace);
    commitBaseline(workspace);
    const config = createIsolatedConfigDir(base);
    assertIsolation(config.dir, workspace, arm);

    const args = [
      '-p',
      '--output-format', 'json',
      '--permission-mode', 'acceptEdits',
      '--allowedTools', ALLOWED_TOOLS,
      '--max-budget-usd', String(Math.min(opts.runCap, remainingBudget).toFixed(2)),
      ...(opts.model ? ['--model', opts.model] : []),
    ];
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    const res = spawnSync('claude', args, {
      cwd: workspace,
      env: buildChildEnv(config.dir),
      input: task.prompt,
      encoding: 'utf8',
      timeout: opts.timeoutMin * 60_000,
      killSignal: 'SIGKILL',
      maxBuffer: 64 * 1024 * 1024,
    });
    const wallSeconds = (Date.now() - t0) / 1000;

    const timedOut = res.error && (res.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
    const result: ClaudeResult | null = parseClaudeResult(res.stdout ?? '');
    writeFileSync(path.join(rawDir, `${arm}-t${task.id}-r${run}.claude.json`), res.stdout || `${res.stderr}\n${String(res.error ?? '')}`);

    let exitStatus: RunMetrics['exitStatus'] = 'completed';
    let error: string | undefined;
    if (timedOut) { exitStatus = 'timeout'; error = `timeout after ${opts.timeoutMin} min`; }
    else if (!result) { exitStatus = 'cli_failure'; error = `no JSON result (exit ${res.status}): ${(res.stderr ?? '').slice(0, 500)}`; }
    else if (result.is_error) { exitStatus = 'agent_error'; error = result.subtype ?? 'is_error'; }

    const { metrics, hiddenOutput } = collectMetrics({ arm, task, run, workspace, startedAt, claudeVersion: version, wallSeconds, exitStatus, result, error });
    writeFileSync(path.join(rawDir, `${arm}-t${task.id}-r${run}.hidden-tests.txt`), hiddenOutput);
    return metrics;
  } finally {
    if (!opts.keep) rmSync(base, { recursive: true, force: true });
  }
}

function main(): void {
  const opts = parseOptions(process.argv.slice(2));
  const outDir = path.join(BENCH_DIR, 'results', opts.date);
  const rawDir = path.join(outDir, 'raw');
  mkdirSync(rawDir, { recursive: true });
  const ndjson = path.join(outDir, 'runs.ndjson');
  const done = readDone(ndjson);
  const doneKeys = new Set(done.map((m) => m.key));
  let spent = done.reduce((sum, m) => sum + (m.costUsd ?? 0), 0);
  const version = claudeVersion();
  console.log(`claude ${version}; results -> ${outDir}; spent so far $${spent.toFixed(2)} of $${opts.budget}`);

  for (const task of opts.tasks) {
    for (let run = 1; run <= opts.runs; run++) {
      for (const arm of opts.arms) {
        const key = `${arm}|${task.id}|${run}`;
        if (doneKeys.has(key)) { console.log(`skip ${key} (recorded)`); continue; }
        const remaining = opts.budget - spent;
        if (remaining < 0.5) {
          console.error(`BUDGET CAP: spent $${spent.toFixed(2)} of $${opts.budget}; stopping before ${key}`);
          process.exit(2);
        }
        console.log(`run ${key} ...`);
        const m = runOne(opts, arm, task, run, remaining, version, rawDir);
        appendFileSync(ndjson, `${JSON.stringify(m)}\n`);
        spent += m.costUsd ?? 0;
        console.log(`  ${m.exitStatus} cost=$${m.costUsd?.toFixed(3) ?? '?'} wall=${m.wallSeconds.toFixed(0)}s hidden=${m.hidden.ok ? 'PASS' : 'FAIL'} (${m.hidden.pass}/${m.hidden.pass + m.hidden.fail}) subagents=${m.subagents ?? '?'} cumulative=$${spent.toFixed(2)}`);
        if (m.costUsd === null) console.warn('  WARNING: cost unknown for this run; cumulative total may be understated');
      }
    }
  }
  console.log('done. Report: node scripts/benchmark/benchmark-report.ts ' + opts.date);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
