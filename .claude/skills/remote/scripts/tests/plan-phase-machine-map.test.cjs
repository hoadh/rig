'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const M = require('../lib/plan-phase-machine-map.cjs');

const SHA = 'b'.repeat(40);
/** rows: [phaseNo, machine|null, owns[], extraFm] */
function makePlan(rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-map-'));
  const table = rows.map(([n]) => `| ${n} | [Name ${n}](./phase-${n}-x.md) | Pending |`).join('\n');
  fs.writeFileSync(path.join(dir, 'plan.md'), `---\nbranch: main\n---\n| Phase | Name | Status |\n|---|---|---|\n${table}\n`);
  for (const [n, machine, owns = [], extra = ''] of rows) {
    fs.writeFileSync(path.join(dir, `phase-${n}-x.md`), `---\n${machine ? `machine: ${machine}\n` : ''}owns: [${owns.join(', ')}]\n${extra}---\nbody ${n}\n`);
  }
  return dir;
}
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });

t.test('ordered map with machine, owns, dependsOn, reviewedSha', () => {
  const d = makePlan([['01', 'waso', ['src/a/**']], ['02', 'waso', ['src/b/**'], `dependsOn: [01]\nreviewedSha: ${SHA}\n`], ['03', 'mac', ['ui/**'], 'dependsOn: ["02"]\n'], ['04', null]]);
  try {
    const map = M.buildPhaseMap(d);
    t.eq(map.map((e) => [e.phase, e.machine]), [['01', 'waso'], ['02', 'waso'], ['03', 'mac'], ['04', null]]);
    t.eq([map[1].dependsOn, map[1].reviewedSha, map[2].dependsOn], [['01'], SHA, ['02']]);
    t.eq(M.ownsUnion(map, 'waso'), ['src/a/**', 'src/b/**']);
    t.eq(M.machineOrder(map), ['waso', 'mac']);
    t.ok(M.assertSameMachineContiguous(map));
  } finally { rm(d); }
});

t.test('non-contiguous machine phases -> exit 2 naming phases', () => {
  const d = makePlan([['01', 'waso', ['a/**']], ['02', 'mac', ['b/**']], ['03', 'waso', ['c/**']]]);
  try {
    const e = t.throwsRemote(() => M.assertSameMachineContiguous(M.buildPhaseMap(d)), { exitCode: 2 });
    t.ok(e.message.includes('waso') && e.message.includes('01, 03'));
  } finally { rm(d); }
});

t.test('local phases between do not break contiguity', () => {
  const d = makePlan([['01', 'waso', ['a/**']], ['02', null], ['03', 'waso', ['c/**']]]);
  try { t.ok(M.assertSameMachineContiguous(M.buildPhaseMap(d))); } finally { rm(d); }
});

t.test('invalid values from an untrusted plan are rejected (exit 2)', () => {
  for (const [machine, extra] of [['Bad Name', ''], ['waso', 'reviewedSha: nothex\n'], ['waso', 'dependsOn: [../x]\n']]) {
    const d = makePlan([['01', machine, ['a/**'], extra]]);
    try { t.throwsRemote(() => M.buildPhaseMap(d), { exitCode: 2 }); } finally { rm(d); }
  }
});

t.test('phase link escaping the plan dir is rejected', () => {
  const d = makePlan([['01', 'waso', ['a/**']]]);
  try {
    fs.writeFileSync(path.join(d, 'plan.md'), '| Phase | Name | Status |\n|---|---|---|\n| 1 | [X](../outside.md) | Pending |\n');
    t.throwsRemote(() => M.buildPhaseMap(d), { exitCode: 2 });
  } finally { rm(d); }
});

t.done();
