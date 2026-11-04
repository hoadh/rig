/**
 * Workspace helpers: fixture copy, task setup overlay, hidden-test copy, node test runner.
 * Shared by the runner and the hidden-test verifier.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BenchmarkTask, TestCounts } from './benchmark-types.ts';

export const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = path.join(BENCH_DIR, 'fixture');
export const HIDDEN_SUBDIR = path.join('test', '__hidden__');

export function loadTasks(): BenchmarkTask[] {
  const dir = path.join(BENCH_DIR, 'tasks');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as BenchmarkTask);
}

/** Copies the fixture into `dest` and lays the task's setup overlay over it. */
export function prepareWorkspace(dest: string, task: BenchmarkTask): void {
  mkdirSync(dest, { recursive: true });
  cpSync(FIXTURE_DIR, dest, { recursive: true, filter: (src) => !src.includes('node_modules') });
  if (task.setupDir) cpSync(path.join(BENCH_DIR, task.setupDir), dest, { recursive: true });
}

/** Copies the task's hidden `*.test.ts` files into `<workspace>/test/__hidden__/`. */
export function copyHiddenTests(workspace: string, task: BenchmarkTask): void {
  const src = path.join(BENCH_DIR, task.hiddenTestsDir);
  const dest = path.join(workspace, HIDDEN_SUBDIR);
  mkdirSync(dest, { recursive: true });
  for (const f of readdirSync(src).filter((n) => n.endsWith('.test.ts'))) {
    cpSync(path.join(src, f), path.join(dest, f));
  }
}

/** Runs node's test runner (spec reporter) and parses pass/fail counts. */
export function runNodeTests(workspace: string, target: string, timeoutMs = 120_000): TestCounts & { output: string } {
  const res = spawnSync(process.execPath, ['--test', '--test-reporter=spec', target], {
    cwd: workspace,
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  const count = (label: string) => Number(new RegExp(`^ℹ ${label} (\\d+)`, 'm').exec(output)?.[1] ?? 0);
  const pass = count('pass');
  const fail = count('fail');
  return { pass, fail, ok: res.status === 0 && pass > 0 && fail === 0, output };
}

export function patchPath(task: BenchmarkTask): string {
  return path.join(BENCH_DIR, task.hiddenTestsDir, 'reference.patch');
}

export function hasReferencePatch(task: BenchmarkTask): boolean {
  return existsSync(patchPath(task));
}
