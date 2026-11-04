/**
 * Collects per-run metrics after the agent finished: claude JSON result, git diff scope,
 * lint errors on the diff and hidden-test outcome.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Arm, BenchmarkTask, RunMetrics } from './benchmark-types.ts';
import { BENCH_DIR, copyHiddenTests, HIDDEN_SUBDIR, runNodeTests } from './benchmark-workspace.ts';

const REPO_ROOT = path.resolve(BENCH_DIR, '..', '..');

/** Paths created/changed by Rig tooling rather than by the task itself. */
const TOOLING_PREFIXES = ['.claude/', 'plans/', '.agent/', '.gemini/', 'node_modules/'];
const TOOLING_FILES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.rig.json', '.gitignore', '.mcp.json'];

export interface ClaudeResult {
  is_error?: boolean;
  subtype?: string;
  total_cost_usd?: number;
  num_turns?: number;
  duration_api_ms?: number;
  permission_denials?: unknown[];
  subagent_stats?: { spawned?: number };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  modelUsage?: Record<string, unknown>;
  result?: string;
}

/** Parses `claude -p --output-format json` stdout; returns null when it is not a JSON object. */
export function parseClaudeResult(stdout: string): ClaudeResult | null {
  try {
    const parsed: unknown = JSON.parse(stdout);
    const obj = Array.isArray(parsed) ? parsed.find((e) => e && e.type === 'result') : parsed;
    return obj && typeof obj === 'object' ? (obj as ClaudeResult) : null;
  } catch {
    return null;
  }
}

function git(workspace: string, args: string[]): string {
  const res = spawnSync('git', args, { cwd: workspace, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
  return res.stdout;
}

/** Files changed vs. the baseline commit (modified, added, deleted, untracked). */
export function changedFiles(workspace: string): string[] {
  const out = git(workspace, ['status', '--porcelain=v1', '-uall', '-z']);
  const files: string[] = [];
  const parts = out.split('\0').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    files.push(entry.slice(3));
    if (entry[0] === 'R' || entry[0] === 'C') i++; // rename/copy entries carry the origin path next
  }
  return files;
}

export function isToolingFile(file: string): boolean {
  return TOOLING_FILES.includes(file) || TOOLING_PREFIXES.some((p) => file.startsWith(p));
}

export function isInScope(file: string, scope: string[]): boolean {
  return scope.some((s) => (s.endsWith('/') ? file.startsWith(s) : file === s));
}

/** ESLint (repo config) errors on changed, still-existing .ts files. Returns -1 when eslint itself fails. */
export function countLintErrors(workspace: string, files: string[]): number {
  const ts = files.filter((f) => f.endsWith('.ts') && !isToolingFile(f));
  if (ts.length === 0) return 0;
  const res = spawnSync(
    process.execPath,
    [
      path.join(REPO_ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js'),
      '--config',
      path.join(REPO_ROOT, 'eslint.config.mjs'),
      '--no-warn-ignored',
      '-f',
      'json',
      ...ts.filter((f) => existsSync(path.join(workspace, f))),
    ],
    { cwd: workspace, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  try {
    const reports = JSON.parse(res.stdout) as { errorCount: number }[];
    return reports.reduce((n, r) => n + r.errorCount, 0);
  } catch {
    return -1;
  }
}

export interface CollectInput {
  arm: Arm;
  task: BenchmarkTask;
  run: number;
  workspace: string;
  startedAt: string;
  claudeVersion: string;
  wallSeconds: number;
  exitStatus: RunMetrics['exitStatus'];
  result: ClaudeResult | null;
  error?: string;
}

/** Runs visible + hidden tests and builds the full metrics record. */
export function collectMetrics(input: CollectInput): { metrics: RunMetrics; hiddenOutput: string } {
  const { arm, task, run, workspace, result } = input;
  const files = changedFiles(workspace);
  const toolingArtifactFiles = files.filter(isToolingFile).length;
  const source = files.filter((f) => !isToolingFile(f));
  const outOfScopeFiles = source.filter((f) => !isInScope(f, task.expectedScope));
  const lintErrors = countLintErrors(workspace, source);

  // Visible suite first (agent's own tests included), then hidden tests are copied in.
  const visible = runNodeTests(workspace, 'test/**/*.test.ts');
  copyHiddenTests(workspace, task);
  const hidden = runNodeTests(workspace, HIDDEN_SUBDIR);

  const usage = result?.usage;
  const metrics: RunMetrics = {
    key: `${arm}|${task.id}|${run}`,
    arm,
    task: task.id,
    run,
    startedAt: input.startedAt,
    claudeVersion: input.claudeVersion,
    model: result?.modelUsage ? Object.keys(result.modelUsage).join(',') : null,
    exitStatus: input.exitStatus,
    costUsd: result?.total_cost_usd ?? null,
    inputTokens: usage?.input_tokens ?? null,
    outputTokens: usage?.output_tokens ?? null,
    cacheReadTokens: usage?.cache_read_input_tokens ?? null,
    cacheCreationTokens: usage?.cache_creation_input_tokens ?? null,
    wallSeconds: input.wallSeconds,
    apiSeconds: result?.duration_api_ms != null ? result.duration_api_ms / 1000 : null,
    turns: result?.num_turns ?? null,
    subagents: result?.subagent_stats?.spawned ?? null,
    permissionDenials: result?.permission_denials?.length ?? null,
    hidden: { pass: hidden.pass, fail: hidden.fail, ok: hidden.ok },
    visible: { pass: visible.pass, fail: visible.fail, ok: visible.ok },
    changedFiles: files,
    outOfScopeFiles,
    toolingArtifactFiles,
    lintErrors,
    ...(input.error ? { error: input.error } : {}),
  };
  return { metrics, hiddenOutput: hidden.output };
}
