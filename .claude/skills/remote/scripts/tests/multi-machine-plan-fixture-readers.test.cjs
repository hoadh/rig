'use strict';
/** rig:remote's own plan readers on the shared multi-machine fixture, LF and CRLF. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const { buildPhaseMap, assertSameMachineContiguous, ownsUnion } = require('../lib/plan-phase-machine-map.cjs');
const { parseFrontmatter } = require('../lib/plan-frontmatter.cjs');

const FIXTURE = path.join(__dirname, 'fixtures', 'multi-machine-plan');

function copy(crlf) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-mm-fix-'));
  for (const f of fs.readdirSync(FIXTURE)) {
    const text = fs.readFileSync(path.join(FIXTURE, f), 'utf8');
    fs.writeFileSync(path.join(d, f), crlf ? text.replace(/\r?\n/g, '\r\n') : text);
  }
  return d;
}

for (const crlf of [false, true]) {
  t.test(`${crlf ? 'CRLF' : 'LF'}: phase map carries machine/owns/dependsOn/reviewedSha`, () => {
    const d = copy(crlf);
    try {
      const map = buildPhaseMap(d);
      t.eq(map.map((e) => e.machine), [null, 'beta', 'gamma']);
      t.eq(map[1].owns, ['src/beta/**', 'docs/beta.md']);
      t.eq(map[2].owns, ['src/gamma/**']);
      t.eq(map[2].dependsOn, ['02']);
      t.eq(map[1].reviewedSha, 'a'.repeat(40));
      t.eq(ownsUnion(map, 'beta'), ['src/beta/**', 'docs/beta.md']);
      t.ok(assertSameMachineContiguous(map));
      t.eq(parseFrontmatter(fs.readFileSync(path.join(d, 'plan.md'), 'utf8')).orchestrator, 'alpha');
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });
}

t.done();
