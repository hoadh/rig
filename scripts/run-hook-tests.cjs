#!/usr/bin/env node
/**
 * Runs every hook test file under .claude/hooks, plus the installer tests in
 * scripts/install-kit, and exits non-zero if any fails.
 * Used by `npm test`; run it before a release.
 *
 * Test files are plain Node scripts (some use node:test, some print their own
 * results); each one is run as `node <file>` and judged by its exit code.
 * Files run in parallel; output is printed only for failures.
 * Files listed in SERIAL_FILES rewrite shared repo files, so they run alone afterwards.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const HOOKS_DIR = path.join(ROOT, '.claude', 'hooks');
const INSTALLER_DIR = path.join(ROOT, 'scripts', 'install-kit');
const TIMEOUT_MS = 180000;
const CONCURRENCY = Math.max(2, Math.min(os.cpus().length, 8));

// Matches foo.test.cjs and test-foo.cjs; helpers like statusline-suite.cjs
// (an aggregate runner over the statusline tests) are skipped.
const TEST_FILE = /^(test-.+|.+\.test)\.cjs$/;

// Run alone, after the parallel batch: hook-logger.test.cjs truncates
// .claude/hooks/.logs/hook-log.jsonl, which other hooks append to.
const SERIAL_FILES = new Set(['__tests__/hook-logger.test.cjs']);

function findTestFiles(dir, inTestDir = false) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      files.push(...findTestFiles(full, inTestDir || ['__tests__', 'tests'].includes(entry.name)));
    } else if (inTestDir && TEST_FILE.test(entry.name)) {
      files.push(full);
    }
  }
  return files.sort();
}

function runFile(file) {
  return new Promise((resolve) => {
    const started = Date.now();
    let output = '';
    // On POSIX the test gets its own process group, so a timeout also kills the
    // hooks, git and shells it spawned (they would otherwise keep the pipes open
    // and 'close' would never fire).
    const posix = process.platform !== 'win32';
    const child = spawn(process.execPath, [file], { cwd: ROOT, env: process.env, detached: posix });
    const timer = setTimeout(() => {
      output += `\n[timed out after ${TIMEOUT_MS / 1000}s]`;
      try {
        if (posix) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ file, ok: code === 0 && !signal, code, signal, output, ms: Date.now() - started });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ file, ok: false, code: null, signal: null, output: String(err), ms: Date.now() - started });
    });
  });
}

async function main() {
  // Installer tests sit next to their modules, so the whole dir counts as a test dir
  const files = [...findTestFiles(HOOKS_DIR), ...findTestFiles(INSTALLER_DIR, true)];
  if (files.length === 0) {
    console.error('No hook test files found under .claude/hooks');
    process.exit(1);
  }

  const isSerial = (f) => SERIAL_FILES.has(path.relative(HOOKS_DIR, f).split(path.sep).join('/'));
  const parallelFiles = files.filter((f) => !isSerial(f));
  const serialFiles = files.filter(isSerial);

  const results = [];
  async function runAndReport(file) {
    const result = await runFile(file);
    const rel = path.relative(ROOT, result.file);
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${rel} (${(result.ms / 1000).toFixed(1)}s)`);
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
    console.log(`\n--- ${path.relative(ROOT, r.file)} (exit ${r.code}${r.signal ? `, ${r.signal}` : ''})`);
    console.log(r.output.trim());
  }
  console.log(`\n${results.length - failed.length}/${results.length} hook test files passed`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main();
