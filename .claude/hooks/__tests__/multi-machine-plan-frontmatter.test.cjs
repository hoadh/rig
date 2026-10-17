#!/usr/bin/env node
/**
 * Hooks must be unaffected by rig:remote multi-machine plan fields
 * (orchestrator:, machine:, owns:, dependsOn:, reviewedSha:, reviewScore:).
 * subagent-init only assembles plan paths/guidance and never parses plan files.
 * Run: node .claude/hooks/__tests__/multi-machine-plan-frontmatter.test.cjs
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HOOKS = path.join(__dirname, '..');

describe('subagent-init does not parse plan files', () => {
  it('source never reads phase/plan frontmatter', () => {
    const src = fs.readFileSync(path.join(HOOKS, 'subagent-init.cjs'), 'utf8');
    assert.ok(!/frontmatter|readFileSync\([^)]*plan\.md/i.test(src), 'subagent-init must not parse plan frontmatter');
  });
});
