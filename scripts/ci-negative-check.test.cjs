#!/usr/bin/env node
// Negative CI check (plan 1427): this file must turn CI red. Never merge it.
const assert = require('node:assert');
const { test } = require('node:test');

const unusedOnPurpose = 1; // lint error on purpose (no-unused-vars)

test('CI must fail on a failing test', () => {
  assert.strictEqual(1, 2, 'failing on purpose');
});
