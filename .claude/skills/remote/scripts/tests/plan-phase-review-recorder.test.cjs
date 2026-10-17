'use strict';
/** reviewedSha/reviewScore write-back: only those lines change, CRLF preserved, input validated. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const { recordReview } = require('../lib/plan-phase-review-recorder.cjs');
const { parseFrontmatter } = require('../lib/plan-frontmatter.cjs');

const SHA = 'b'.repeat(40);
const body = '# Phase\n\nbody stays\n';
const withDir = (fn) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-review-'));
  try { fn(d); } finally { fs.rmSync(d, { recursive: true, force: true }); }
};

t.test('writes reviewedSha + reviewScore, body and other keys untouched', () => withDir((d) => {
  const f = path.join(d, 'phase-01-x.md');
  fs.writeFileSync(f, `---\nmachine: beta\nowns: [src/**]\n---\n${body}`);
  t.eq(recordReview(f, { sha: SHA, score: '9.5' }), { sha: SHA, score: 9.5 });
  const text = fs.readFileSync(f, 'utf8');
  t.eq(parseFrontmatter(text), { machine: 'beta', owns: ['src/**'], reviewedSha: SHA, reviewScore: '9.5' });
  t.ok(text.endsWith(body));
  recordReview(f, { sha: 'c'.repeat(40) }); // re-review replaces sha, keeps score
  t.eq(parseFrontmatter(fs.readFileSync(f, 'utf8')).reviewedSha, 'c'.repeat(40));
}));

t.test('CRLF phase file keeps CRLF', () => withDir((d) => {
  const f = path.join(d, 'phase-01-x.md');
  fs.writeFileSync(f, '---\r\nmachine: beta\r\n---\r\nbody\r\n');
  recordReview(f, { sha: SHA, score: 8 });
  const text = fs.readFileSync(f, 'utf8');
  t.ok(!/[^\r]\n/.test(text), 'bare LF introduced');
  t.eq(parseFrontmatter(text).reviewedSha, SHA);
}));

t.test('rejects bad sha, bad score, missing frontmatter', () => withDir((d) => {
  const f = path.join(d, 'phase-01-x.md');
  fs.writeFileSync(f, '---\nmachine: beta\n---\nx\n');
  t.throwsRemote(() => recordReview(f, { sha: 'abc' }), { exitCode: 2 });
  t.throwsRemote(() => recordReview(f, { sha: SHA, score: 11 }), { exitCode: 2 });
  t.throwsRemote(() => recordReview(f, { sha: SHA, score: 'x' }), { exitCode: 2 });
  const g = path.join(d, 'phase-02-y.md');
  fs.writeFileSync(g, 'no frontmatter\n');
  t.throwsRemote(() => recordReview(g, { sha: SHA }), { exitCode: 2 });
  t.ok(!fs.readFileSync(f, 'utf8').includes('reviewedSha'));
}));

t.done();
