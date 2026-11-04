#!/usr/bin/env node
/** Tests for regex-test-with-timeout: vm timeout really interrupts catastrophic regexes on this Node. */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { regexTestWithTimeout, resetTimeoutLatch } = require('../regex-test-with-timeout.cjs');

describe('regexTestWithTimeout', () => {
  beforeEach(resetTimeoutLatch);

  it('matches and does not match normally', () => {
    assert.deepStrictEqual(regexTestWithTimeout('vi+te', '', 'run vite'), { ok: true, matched: true });
    assert.deepStrictEqual(regexTestWithTimeout('VITE', 'i', 'run vite'), { ok: true, matched: true });
    assert.deepStrictEqual(regexTestWithTimeout('nope', '', 'run vite'), { ok: true, matched: false });
  });
  it('reports a compile error as invalid', () => {
    assert.deepStrictEqual(regexTestWithTimeout('(unclosed', '', 'x'), { ok: false, reason: 'invalid' });
  });
  for (const [pattern, text] of [['(a+)+b', 'a'.repeat(40)], ['(.*a){12}x', 'a'.repeat(40)], ['(?:.*?){20}x', 'a'.repeat(40)], ['.*.*Q', 'a'.repeat(7000)]]) {
    it(`interrupts ${pattern} within ~timeout`, () => {
      const t0 = Date.now();
      assert.deepStrictEqual(regexTestWithTimeout(pattern, '', text, { timeoutMs: 200 }), { ok: false, reason: 'timeout' });
      assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0}ms`);
    });
  }
  it('after one timeout later calls short-circuit (bounded total cost)', () => {
    regexTestWithTimeout('(a+)+b', '', 'a'.repeat(40), { timeoutMs: 100 });
    const t0 = Date.now();
    assert.strictEqual(regexTestWithTimeout('(a+)+b', '', 'a'.repeat(40), { timeoutMs: 100 }).reason, 'timeout');
    assert.ok(Date.now() - t0 < 50);
  });
});
