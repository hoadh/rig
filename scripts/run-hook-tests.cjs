#!/usr/bin/env node
/**
 * Discovers and runs every Node test file in the repo and exits non-zero if any fails.
 * Used by `npm test` and CI; run it before a release.
 *
 * Discovery: every *.test.cjs / *.test.js under .claude/ and scripts/ (node_modules,
 * .venv, .git and worktrees are ignored; .agent/ is a generated mirror and is not scanned).
 * Test files are plain Node scripts (some use node:test, some print their own results);
 * each one is run as `node <file>` and judged by its exit code.
 * Files run in parallel; output is printed only for failures.
 * Custom-framework suites (COVERED_BY_RUNNER) run through their own runner instead.
 * Files listed in SERIAL_FILES rewrite shared repo files, so they run alone afterwards.
 *
 * Skips are never silent: files in SKIPPED_FILES are listed with their reason, and any
 * "skipped" count a test prints itself (node:test summary, "SKIP" lines) is surfaced.
 * The final line reports passed/failed/skipped.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = [path.join(ROOT, '.claude'), path.join(ROOT, 'scripts')];
const IGNORED_DIRS = new Set(['node_modules', '.venv', '.git', 'worktrees']);
// Per-file timeout. Windows runners spawn git/node/powershell 10-15x slower than Linux: the rig:remote
// loopback e2e takes ~13 s on ubuntu-latest and ~180 s on windows-latest, so one limit cannot fit both.
// RIG_TEST_TIMEOUT_MS overrides both defaults.
const TIMEOUT_MS = Number(process.env.RIG_TEST_TIMEOUT_MS) || (process.platform === 'win32' ? 480000 : 180000);
const CONCURRENCY = Math.max(2, Math.min(os.cpus().length, 8));

// Matches foo.test.cjs and foo.test.js; helpers (statusline-suite.cjs, test-framework.cjs,
// test-clone-config-resetter.cjs) are not tests and are not picked up.
const TEST_FILE = /\.test\.(cjs|js)$/;

// Run alone, after the parallel batch: hook-logger.test.cjs truncates
// .claude/hooks/.logs/hook-log.jsonl, which other hooks append to.
const SERIAL_FILES = new Set(['.claude/hooks/__tests__/hook-logger.test.cjs']);

// Test files that cannot run under plain `node <file>`. Each entry needs a reason;
// it is printed on every run so the skip stays visible.
const SKIPPED_FILES = new Map([
]);

// Custom-framework suites: they rely on the `describe` global installed by
// tests/test-framework.cjs, so `node <file>` fails. They run through their own runner,
// which is executed once in place of the listed files.
const MARKDOWN_VIEWER_RUNNER = '.claude/skills/markdown-viewer/tests/run-tests.cjs';
const COVERED_BY_RUNNER = new Map([
  ['.claude/skills/markdown-viewer/tests/http-server.test.cjs', MARKDOWN_VIEWER_RUNNER],
]);

const toPosix = (p) => p.split(path.sep).join('/');

function findTestFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      files.push(...findTestFiles(full));
    } else if (TEST_FILE.test(entry.name)) {
      files.push(full);
    }
  }
  return files.sort();
}

function runFile(file) {
  return new Promise((resolve) => {
    const started = Date.now();
    let output = '';
    let settled = false;
    // On POSIX the test gets its own process group, so a timeout also kills the
    // hooks, git and shells it spawned (they would otherwise keep the pipes open
    // and 'close' would never fire).
    const posix = process.platform !== 'win32';
    const child = spawn(process.execPath, [file], { cwd: ROOT, env: process.env, detached: posix });
    const finish = (extra) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ file, output, ms: Date.now() - started, ...extra });
    };
    const killTree = () => {
      try {
        if (posix) process.kill(-child.pid, 'SIGKILL');
        else spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        try { child.kill('SIGKILL'); } catch {}
      }
    };
    const timer = setTimeout(() => {
      output += `\n[timed out after ${TIMEOUT_MS / 1000}s]`;
      killTree();
      // Orphaned grandchildren can keep the stdio pipes open so 'close' never fires;
      // 'exit' fires once the child itself dies, and the guard resolves if even that is lost.
      setTimeout(() => finish({ ok: false, code: null, signal: 'SIGKILL' }), 5000).unref();
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('exit', (code, signal) => {
      // Give stdio a moment to drain, then resolve even if grandchildren hold the pipes.
      setTimeout(() => finish({ ok: code === 0 && !signal, code, signal }), 1000).unref();
    });
    child.on('close', (code, signal) => finish({ ok: code === 0 && !signal, code, signal }));
    child.on('error', (err) => {
      output += String(err);
      finish({ ok: false, code: null, signal: null });
    });
  });
}

// Skip counts and SKIP lines a test reports about itself (node:test summary, custom output).
function extractSelfReportedSkips(output) {
  const lines = [];
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(/^# skipped (\d+)/);
    if (m ? Number(m[1]) > 0 : /\bSKIP(PED)?\b/.test(line)) lines.push(line.trim());
  }
  return lines.slice(0, 20);
}

async function main() {
  const discovered = SCAN_DIRS.flatMap(findTestFiles);
  if (discovered.length === 0) {
    console.error('No test files found under .claude/ or scripts/');
    process.exitCode = 1;
    return;
  }
  const rel = (f) => toPosix(path.relative(ROOT, f));
  const skipped = discovered.filter((f) => SKIPPED_FILES.has(rel(f)));
  const runners = [...new Set(discovered.map(rel).filter((f) => COVERED_BY_RUNNER.has(f)).map((f) => COVERED_BY_RUNNER.get(f)))];
  const files = [
    ...discovered.filter((f) => !SKIPPED_FILES.has(rel(f)) && !COVERED_BY_RUNNER.has(rel(f))),
    ...runners.map((r) => path.join(ROOT, r)),
  ];
  // A stale SKIPPED_FILES entry would hide a rename; fail loudly instead.
  const known = new Set(discovered.map(rel));
  const stale = [...SKIPPED_FILES.keys(), ...COVERED_BY_RUNNER.keys()].filter((k) => !known.has(k));
  const missingRunners = runners.filter((r) => !fs.existsSync(path.join(ROOT, r)));
  if (stale.length > 0 || missingRunners.length > 0) {
    console.error(`SKIPPED_FILES/COVERED_BY_RUNNER entries match no file: ${[...stale, ...missingRunners].join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const isSerial = (f) => SERIAL_FILES.has(rel(f));
  const parallelFiles = files.filter((f) => !isSerial(f));
  const serialFiles = files.filter(isSerial);

  const results = [];
  async function runAndReport(file) {
    const result = await runFile(file);
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${rel(result.file)} (${(result.ms / 1000).toFixed(1)}s)`);
    results.push(result);
  }

  let next = 0;
  async function worker() {
    while (next < parallelFiles.length) await runAndReport(parallelFiles[next++]);
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  for (const file of serialFiles) await runAndReport(file);

  const failed = results.filter((r) => !r.ok);
  for (const r of failed) {
    console.log(`\n--- ${rel(r.file)} (exit ${r.code}${r.signal ? `, ${r.signal}` : ''})`);
    console.log(r.output.trim());
  }

  console.log('\nSkipped test files:');
  for (const f of skipped) console.log(`  SKIP ${rel(f)}: ${SKIPPED_FILES.get(rel(f))}`);
  if (skipped.length === 0) console.log('  (none)');
  const selfSkips = results.filter((r) => r.ok).map((r) => ({ r, lines: extractSelfReportedSkips(r.output) })).filter((x) => x.lines.length > 0);
  if (selfSkips.length > 0) {
    console.log('\nTests skipped inside passing files (reported by the tests themselves):');
    for (const { r, lines } of selfSkips) {
      console.log(`  ${rel(r.file)}`);
      for (const l of lines) console.log(`    ${l}`);
    }
  }

  const passed = results.length - failed.length;
  console.log(`\n${passed} passed, ${failed.length} failed, ${skipped.length} skipped (of ${discovered.length} test files)`);
  process.exitCode = failed.length > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
