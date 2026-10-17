'use strict';
// worker.cjs over plain ssh: non-TTY stdin that is empty -> manual envelope; garbage still rejected.
const path = require('path');
const { spawnSync } = require('child_process');
const t = require('./minimal-test-harness.cjs');

const WORKER = path.join(__dirname, '..', 'worker.cjs');
const run = (input) => spawnSync(process.execPath, [WORKER, 'info'], { input, encoding: 'utf8' });

t.test('empty stdin (plain ssh) fabricates manual envelope', () => {
  for (const input of ['', '  \n']) {
    const r = run(input);
    t.eq(r.status, 0, r.stderr);
    t.ok(/^RIGJSON:/m.test(r.stdout), r.stdout);
  }
});
t.test('non-empty invalid JSON stdin is still rejected', () => {
  const r = run('{not json');
  t.eq(r.status, 2);
  t.ok(/stdin envelope is not JSON/.test(r.stderr), r.stderr);
});

t.done();
