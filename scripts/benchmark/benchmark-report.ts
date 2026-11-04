/**
 * Builds results/<date>/summary.md from runs.ndjson: per (task, arm) median and min-max.
 *
 *   node scripts/benchmark/benchmark-report.ts <date>
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Arm, RunMetrics } from './benchmark-types.ts';
import { BENCH_DIR, loadTasks } from './benchmark-workspace.ts';

function nums(values: (number | null)[]): number[] {
  return values.filter((v): v is number => v !== null).sort((a, b) => a - b);
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** "median (min-max)" or "n/a". */
function cell(values: (number | null)[], digits = 0, prefix = ''): string {
  const s = nums(values);
  const med = median(s);
  if (med === null) return 'n/a';
  const f = (n: number) => `${prefix}${n.toFixed(digits)}`;
  return s.length === 1 ? f(med) : `${f(med)} (${f(s[0])}-${f(s[s.length - 1])})`;
}

function rowFor(runs: RunMetrics[]): string[] {
  const passes = runs.filter((r) => r.hidden.ok).length;
  const outOfScope = runs.reduce((n, r) => n + r.outOfScopeFiles.length, 0);
  const problems = runs.filter((r) => r.exitStatus !== 'completed').length;
  return [
    String(runs.length),
    `${passes}/${runs.length}`,
    cell(runs.map((r) => r.costUsd), 2, '$'),
    cell(runs.map((r) => r.wallSeconds)),
    cell(runs.map((r) => r.turns)),
    cell(runs.map((r) => r.subagents)),
    String(outOfScope),
    String(runs.reduce((n, r) => n + Math.max(0, r.lintErrors), 0)),
    String(runs.reduce((n, r) => n + (r.permissionDenials ?? 0), 0)),
    String(problems),
  ];
}

export function buildSummary(date: string, all: RunMetrics[]): string {
  const tasks = loadTasks();
  const header = ['Task', 'Arm', 'Runs', 'Hidden pass', 'Cost USD', 'Wall s', 'Turns', 'Subagents', 'Out-of-scope files', 'Lint errors', 'Perm. denials', 'Non-completed'];
  const lines = [`# Rig vs vanilla benchmark - ${date}`, ''];
  const versions = [...new Set(all.map((r) => r.claudeVersion))].join(', ');
  const models = [...new Set(all.map((r) => r.model ?? 'unknown'))].join(', ');
  lines.push(`Claude Code: ${versions}. Model(s): ${models}. Runs: ${all.length}. Cells show median (min-max). No significance claims: n per cell is small.`, '');
  lines.push(`| ${header.join(' | ')} |`, `|${header.map(() => ' --- ').join('|')}|`);
  for (const task of tasks) {
    for (const arm of ['vanilla', 'rig'] as Arm[]) {
      const runs = all.filter((r) => r.task === task.id && r.arm === arm);
      if (runs.length > 0) lines.push(`| ${task.id}. ${task.kind} | ${arm} | ${rowFor(runs).join(' | ')} |`);
    }
  }
  lines.push('', '## Totals per arm', '', `| Arm | ${header.slice(2).join(' | ')} |`, `|${header.slice(1).map(() => ' --- ').join('|')}|`);
  const totals: string[] = [];
  for (const arm of ['vanilla', 'rig'] as Arm[]) {
    const runs = all.filter((r) => r.arm === arm);
    const total = nums(runs.map((r) => r.costUsd)).reduce((a, b) => a + b, 0);
    if (runs.length === 0) continue;
    lines.push(`| ${arm} | ${rowFor(runs).join(' | ')} |`);
    totals.push(`- ${arm}: total cost ${'$'}${total.toFixed(2)} over ${runs.length} runs`);
  }
  lines.push('', ...totals);
  lines.push('', 'Hidden pass = all hidden tests for the task pass after the agent finished (tests copied in afterwards).', 'Out-of-scope files exclude Rig tooling artifacts (.claude/, plans/, CLAUDE.md ...).', '');
  return lines.join('\n');
}

function main(): void {
  const date = process.argv[2];
  if (!date) throw new Error('Usage: benchmark-report.ts <date>');
  const dir = path.join(BENCH_DIR, 'results', date);
  const file = path.join(dir, 'runs.ndjson');
  if (!existsSync(file)) throw new Error(`No runs found at ${file}`);
  const all = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as RunMetrics);
  const summary = buildSummary(date, all);
  writeFileSync(path.join(dir, 'summary.md'), summary);
  console.log(summary);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
