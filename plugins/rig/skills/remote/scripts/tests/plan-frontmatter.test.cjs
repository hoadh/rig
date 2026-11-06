'use strict';
const t = require('./minimal-test-harness.cjs');
const P = require('../lib/plan-frontmatter.cjs');

const LF = `---
title: "A plan: with colon"
status: pending
priority: P2
tags: [feature, "infra x"]
blockedBy: []
phases:
  - one
  - "two"
note: it's # comment
---

# Body
status: not-frontmatter
`;
const CRLF = LF.replace(/\n/g, '\r\n');

t.test('parses scalars, quoted, inline and block lists (LF)', () => {
  const fm = P.parseFrontmatter(LF);
  t.eq(fm.title, 'A plan: with colon');
  t.eq(fm.status, 'pending');
  t.eq(fm.tags, ['feature', 'infra x']);
  t.eq(fm.blockedBy, []);
  t.eq(fm.phases, ['one', 'two']);
  t.eq(fm.note, "it's");
});
t.test('CRLF parses identically, no stray \\r', () => {
  t.eq(P.parseFrontmatter(CRLF), P.parseFrontmatter(LF));
});
t.test('no frontmatter -> {}', () => t.eq(P.parseFrontmatter('# hi\n'), {}));
t.test('setFrontmatterScalar changes only that line (LF)', () => {
  const out = P.setFrontmatterScalar(LF, 'status', 'done');
  t.eq(out, LF.replace('status: pending', 'status: done'));
});
t.test('setFrontmatterScalar preserves CRLF bytes everywhere', () => {
  const out = P.setFrontmatterScalar(CRLF, 'status', 'in-progress');
  t.eq(out, CRLF.replace('status: pending', 'status: in-progress'));
  t.ok(!/[^\r]\n/.test(out.replace(/\r\n/g, '')));
});
t.test('adds missing key; quotes risky values; body untouched', () => {
  const out = P.setFrontmatterScalar(LF, 'owner', 'a: b');
  t.eq(P.parseFrontmatter(out).owner, 'a: b');
  t.ok(out.endsWith('# Body\nstatus: not-frontmatter\n'));
  const crlfOut = P.setFrontmatterScalar(CRLF, 'owner', 'x');
  t.ok(crlfOut.includes('owner: x\r\n---'));
});
t.test('rejects bad key, multi-line value, missing frontmatter', () => {
  t.assert.throws(() => P.setFrontmatterScalar(LF, 'a b', 'x'));
  t.assert.throws(() => P.setFrontmatterScalar(LF, 'status', 'a\nb'));
  t.assert.throws(() => P.setFrontmatterScalar('# no fm', 'status', 'x'));
});
t.test('does not match a key that is a prefix of another', () => {
  const text = '---\nstatus_note: x\nstatus: a\n---\nbody';
  t.eq(P.setFrontmatterScalar(text, 'status', 'b'), '---\nstatus_note: x\nstatus: b\n---\nbody');
});

t.done();
