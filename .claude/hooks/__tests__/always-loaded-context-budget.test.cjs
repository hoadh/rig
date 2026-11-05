#!/usr/bin/env node
/**
 * Static budget for text that is always loaded into context (Rig 1.1 context reduction).
 * Run: node --test .claude/hooks/__tests__/always-loaded-context-budget.test.cjs
 *
 * - core-rules.md and CLAUDE.md are loaded every session; core-rules.md is also injected into every subagent
 * - agent and skill descriptions sit in the catalog of every session
 * Budgets are bytes (UTF-8) for files and characters for single descriptions.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const CLAUDE_DIR = path.join(ROOT, '.claude');

const LIMITS = {
  coreRulesBytes: 1800,
  claudeMdBytes: 1500,
  agentDescriptionChars: 300,
  skillDescriptionChars: 250,
  skillDescriptionTotalBytes: 5000,
  thinSkillBytes: 2500
};

/** Read `description` and `when_to_use` from YAML frontmatter (single-line or `>-`/`|` block scalars). */
function readFrontmatterText(file) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(file, 'utf8'));
  assert.ok(match, `${file} has frontmatter`);
  const lines = match[1].split(/\r?\n/);
  const out = { description: '', when_to_use: '' };
  for (let i = 0; i < lines.length; i++) {
    const m = /^(description|when_to_use):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    let value = m[2].trim();
    if (/^[>|][-+]?$/.test(value)) {
      const block = [];
      while (i + 1 < lines.length && /^\s+\S|^\s*$/.test(lines[i + 1])) block.push(lines[++i].trim());
      value = block.filter(Boolean).join(' ');
    } else if (/^(['"]).*\1$/.test(value)) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

const bytes = (file) => Buffer.byteLength(fs.readFileSync(file));

describe('always-loaded context budget', () => {

  it(`core-rules.md stays within ${LIMITS.coreRulesBytes} bytes`, () => {
    const size = bytes(path.join(CLAUDE_DIR, 'rules', 'core-rules.md'));
    assert.ok(size <= LIMITS.coreRulesBytes, `core-rules.md is ${size} bytes`);
  });

  it('core-rules.md is the only rules file (task rules live in skill references)', () => {
    const rules = fs.readdirSync(path.join(CLAUDE_DIR, 'rules')).filter((f) => f.endsWith('.md'));
    assert.deepStrictEqual(rules, ['core-rules.md']);
  });

  it(`CLAUDE.md stays within ${LIMITS.claudeMdBytes} bytes`, () => {
    const size = bytes(path.join(ROOT, 'CLAUDE.md'));
    assert.ok(size <= LIMITS.claudeMdBytes, `CLAUDE.md is ${size} bytes`);
  });

  it('keeps the guidance that must reach every subagent in core-rules.md', () => {
    const core = fs.readFileSync(path.join(CLAUDE_DIR, 'rules', 'core-rules.md'), 'utf8');
    for (const needle of ['secrets', 'ssh -G', 'read-only', 'Verify before claiming done', 'English', '**Status:**']) {
      assert.ok(core.includes(needle), `core-rules.md should mention "${needle}"`);
    }
  });

  it(`every agent description is at most ${LIMITS.agentDescriptionChars} chars with no <example> blocks`, () => {
    const dir = path.join(CLAUDE_DIR, 'agents');
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
      const { description } = readFrontmatterText(path.join(dir, file));
      assert.ok(description.length > 0, `${file} has a description`);
      assert.ok(description.length <= LIMITS.agentDescriptionChars, `${file} description is ${description.length} chars`);
      assert.ok(!description.includes('<example>'), `${file} description has an <example> block`);
    }
  });

  it(`every skill description (+when_to_use) is at most ${LIMITS.skillDescriptionChars} chars; total at most ${LIMITS.skillDescriptionTotalBytes} bytes`, () => {
    const dir = path.join(CLAUDE_DIR, 'skills');
    let total = 0;
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name, 'SKILL.md');
      if (!fs.existsSync(file)) continue;
      const { description, when_to_use: whenToUse } = readFrontmatterText(file);
      const text = description + whenToUse;
      assert.ok(description.length > 0, `${name} has a description`);
      assert.ok(text.length <= LIMITS.skillDescriptionChars, `${name} description is ${text.length} chars`);
      total += Buffer.byteLength(text);
    }
    assert.ok(total <= LIMITS.skillDescriptionTotalBytes, `skill descriptions total ${total} bytes`);
  });

  it(`thinned wrapper skills (worktree, explore, code-review, team) keep SKILL.md within ${LIMITS.thinSkillBytes} bytes`, () => {
    for (const name of ['worktree', 'explore', 'code-review', 'team']) {
      const size = bytes(path.join(CLAUDE_DIR, 'skills', name, 'SKILL.md'));
      assert.ok(size <= LIMITS.thinSkillBytes, `${name}/SKILL.md is ${size} bytes`);
    }
  });

});
