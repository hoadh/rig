/** Shared types for the Rig-vs-vanilla benchmark. */

export type Arm = 'vanilla' | 'rig';

export interface BenchmarkTask {
  id: number;
  name: string;
  kind: string;
  prompt: string;
  /** Files/dirs (prefix match, relative to the fixture root) the task is expected to touch. */
  expectedScope: string[];
  /** Directory (relative to scripts/benchmark) holding `*.test.ts` hidden tests and `reference.patch`. */
  hiddenTestsDir: string;
  /** Optional directory whose files are laid over the fixture before the agent starts. */
  setupDir?: string;
}

export interface TestCounts {
  pass: number;
  fail: number;
  /** True when the runner exited 0 and at least one test ran. */
  ok: boolean;
}

export interface RunMetrics {
  key: string;
  arm: Arm;
  task: number;
  run: number;
  startedAt: string;
  claudeVersion: string;
  model: string | null;
  /** Agent outcome. */
  exitStatus: 'completed' | 'agent_error' | 'timeout' | 'cli_failure';
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  wallSeconds: number;
  apiSeconds: number | null;
  turns: number | null;
  subagents: number | null;
  permissionDenials: number | null;
  /** Hidden tests (copied in after the agent finished). */
  hidden: TestCounts;
  /** The repo's own visible suite after the agent finished, before hidden tests were copied. */
  visible: TestCounts;
  changedFiles: string[];
  outOfScopeFiles: string[];
  /** Files under .claude/, plans/, CLAUDE.md etc. created by Rig tooling (not counted as scope violations). */
  toolingArtifactFiles: number;
  /** ESLint errors (repo config) on changed .ts files, parse errors included. */
  lintErrors: number;
  error?: string;
}
