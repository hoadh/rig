'use strict';
/* eslint-disable no-control-regex */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { normalizeAgentType, sanitizeForFilename } = require('../agent-type-normalizer.cjs');

test('normalizeAgentType strips one plugin prefix, lower-cases, defaults to unknown', () => {
  assert.strictEqual(normalizeAgentType('rig:tester'), 'tester');
  assert.strictEqual(normalizeAgentType('tester'), 'tester');
  assert.strictEqual(normalizeAgentType('a:b:c'), 'b:c');
  assert.strictEqual(normalizeAgentType('my_plugin:tester'), 'tester');
  assert.strictEqual(normalizeAgentType('acme.tools:Tester'), 'tester');
  assert.strictEqual(normalizeAgentType('Rig:Code-Reviewer '), 'code-reviewer');
  assert.strictEqual(normalizeAgentType(''), 'unknown');
  assert.strictEqual(normalizeAgentType('rig:'), 'unknown');
  assert.strictEqual(normalizeAgentType(undefined), 'unknown');
  assert.strictEqual(normalizeAgentType(42), 'unknown');
});

test('sanitizeForFilename removes separators, colons and traversal', () => {
  for (const raw of ['rig:x/../y', '..\\..\\evil', 'a:b*c?"<>|', 'x\u0000y\nz', '..']) {
    const s = sanitizeForFilename(raw);
    assert.ok(!/[:\\/*?"<>|\u0000-\u001f]/.test(s), `unsafe chars in ${JSON.stringify(s)}`);
    assert.ok(!s.includes('..'), `traversal in ${s}`);
  }
  assert.strictEqual(sanitizeForFilename('tester'), 'tester');
  assert.strictEqual(sanitizeForFilename(''), 'unknown');
});

test('subagent-init never puts a raw agent_type into a path', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'subagent-init.cjs'), 'utf8');
  assert.ok(!/path\.join\([^)]*\$\{agentType\}/.test(src), 'report filename must use the sanitized name');
});
