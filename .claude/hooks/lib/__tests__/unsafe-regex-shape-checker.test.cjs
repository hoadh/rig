#!/usr/bin/env node
/** Tests for unsafe-regex-shape-checker: rejected shapes, accepted shapes, and a timing bound. */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { checkRegexShape } = require('../unsafe-regex-shape-checker.cjs');

describe('checkRegexShape', () => {
  it('rejects nested, overlapping and ranged quantifier shapes', () => {
    for (const p of ['(a+)+b', '((a+))+$', '(a|aa)+$', '(a{1,})+$', '(a{2,5})*', '((a|b))*', '(?:a+)+', '(x*)*', 'a*a*a*b']) {
      assert.strictEqual(checkRegexShape(p).safe, false, p);
    }
  });
  it('rejects backreferences, unbalanced input and over-long patterns', () => {
    assert.strictEqual(checkRegexShape('(a)\\1').safe, false);
    assert.strictEqual(checkRegexShape('(?<n>a)\\k<n>').safe, false);
    assert.strictEqual(checkRegexShape('(abc').safe, false);
    assert.strictEqual(checkRegexShape('abc)').safe, false);
    assert.strictEqual(checkRegexShape('[abc').safe, false);
    assert.strictEqual(checkRegexShape('a'.repeat(201)).safe, false);
    assert.strictEqual(checkRegexShape('a'.repeat(300), { maxLength: 400 }).safe, true);
    assert.strictEqual(checkRegexShape(42).safe, false);
  });
  it('accepts ordinary patterns', () => {
    for (const p of ['vite', '[v]ite', '^make e2e$', '^(npm|yarn) test$', '(?:ab)+', '(ab){3}', 'foo.*bar', '^(?<n>x+)$', '[a+*)(]+', '\\(a+\\)+']) {
      assert.strictEqual(checkRegexShape(p).safe, true, p);
    }
  });
  it('every rejected shape is the catastrophic one: accepted shapes finish fast on hostile input', () => {
    const hostile = `${'a'.repeat(4000)}!`;
    const t0 = Date.now();
    for (const p of ['^(ab)+$', 'a*b', '^(npm|yarn) test$', 'a.*b.*c']) {
      assert.ok(checkRegexShape(p).safe);
      new RegExp(p).test(hostile);
    }
    assert.ok(Date.now() - t0 < 1000);
  });
});
