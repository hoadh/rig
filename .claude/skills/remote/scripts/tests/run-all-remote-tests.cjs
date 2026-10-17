#!/usr/bin/env node
'use strict';
/**
 * Runs every rig:remote test as its own node process: unit tests first, then
 * the loopback e2e tests (*.e2e.test.cjs), then the out-of-dir consumer tests
 * that guard multi-machine plan frontmatter (plan hooks + _shared parser).
 * Exit 1 if any file fails. Opt-in scenarios print SKIP lines
 * (RIG_E2E_CLAUDE=1 real claude, RIG_E2E_SSH=1 real ssh).
 *   node .claude/skills/remote/scripts/tests/run-all-remote-tests.cjs [name-filter]
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const CLAUDE_DIR = path.join(HERE, '..', '..', '..', '..');
const CONSUMER_TESTS = [
  path.join(CLAUDE_DIR, 'skills', '_shared', 'tests', 'plan-table-parser-multi-machine.test.cjs'),
  path.join(CLAUDE_DIR, 'hooks', '__tests__', 'multi-machine-plan-frontmatter.test.cjs'),
];

const own = fs.readdirSync(HERE).filter((f) => f.endsWith('.test.cjs')).sort();
const files = [
  ...own.filter((f) => !f.endsWith('.e2e.test.cjs')).map((f) => path.join(HERE, f)),
  ...own.filter((f) => f.endsWith('.e2e.test.cjs')).map((f) => path.join(HERE, f)),
  ...CONSUMER_TESTS.filter((f) => fs.existsSync(f)),
].filter((f) => !process.argv[2] || f.includes(process.argv[2]));

let failed = 0;
const t0 = Date.now();
for (const file of files) {
  const start = Date.now();
  const r = spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 600000, env: process.env });
  const secs = ((Date.now() - start) / 1000).toFixed(1);
  const label = path.relative(CLAUDE_DIR, file);
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  if (r.status === 0) {
    console.log(`ok   ${label} (${secs}s)`);
    out.split('\n').filter((l) => /SKIP/.test(l)).forEach((l) => console.log(`       ${l.trim()}`));
  } else {
    failed++;
    console.log(`FAIL ${label} (${secs}s, exit ${r.status}${r.signal ? `, ${r.signal}` : ''})`);
    console.log(out.split('\n').map((l) => `       ${l}`).join('\n'));
  }
}
console.log(`\n${files.length - failed}/${files.length} test files passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exitCode = failed ? 1 : 0;
