#!/usr/bin/env node
/**
 * Tests that plan-table-parser tolerates rig:remote multi-machine plans
 * (orchestrator: in plan.md, machine/owns/dependsOn/reviewedSha/reviewScore in
 * phase frontmatter), in LF and CRLF variants. Behavior must match a plan
 * without those fields.
 * Run: node .claude/skills/_shared/tests/plan-table-parser-multi-machine.test.cjs
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { parsePlanPhases } = require('../lib/plan-table-parser.cjs');

const FIXTURE = path.join(__dirname, '..', '..', 'remote', 'scripts', 'tests', 'fixtures', 'multi-machine-plan');
const toCrlf = (dir) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-mm-crlf-'));
  for (const f of fs.readdirSync(dir)) fs.writeFileSync(path.join(out, f), fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r?\n/g, '\r\n'));
  return out;
};

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  [OK] ${name}`); } catch (e) { failed++; console.log(`  [X]  ${name}\n       ${e.message}`); }
}

function check(dir) {
  const phases = parsePlanPhases(fs.readFileSync(path.join(dir, 'plan.md'), 'utf8'), dir);
  assert.deepStrictEqual(phases.map((p) => [p.phase, p.status]), [[1, 'pending'], [2, 'in-progress'], [3, 'completed']]);
  assert.deepStrictEqual(phases.map((p) => p.name), ['Local scaffolding', 'Beta service', 'Gamma client']);
  assert.ok(phases.every((p) => p.file && fs.existsSync(p.file)), 'phase files resolve');
}

test('LF multi-machine plan parses (3 phases, statuses, files)', () => check(FIXTURE));

const crlfDir = toCrlf(FIXTURE);
test('CRLF multi-machine plan parses identically', () => check(crlfDir));
fs.rmSync(crlfDir, { recursive: true, force: true });

console.log(`${passed}/${passed + failed} passed`);
if (failed) process.exit(1);
