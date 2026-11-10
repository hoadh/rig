'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { parseAgentFrontmatter, agentDefinitionFor, roleLines, isReportOnly, teamRuleLines } = require('../teammate-role-context.cjs');

const PLUGIN_ROOT = path.join(__dirname, '..', '..', '..');

describe('teammate-role-context', () => {
  it('parses tools and a YAML skills list', () => {
    const def = parseAgentFrontmatter('---\nname: x\ntools: Read, Bash\nskills:\n  - rig:git\n  - "rig:debug"\n---\nbody');
    assert.deepStrictEqual(def, { tools: ['Read', 'Bash'], skills: ['rig:git', 'rig:debug'] });
  });
  it('parses an inline skills list and no tools', () => {
    assert.deepStrictEqual(parseAgentFrontmatter('---\nskills: [rig:plan, rig:test]\n---\n'), { tools: null, skills: ['rig:plan', 'rig:test'] });
  });
  it('returns null without frontmatter', () => {
    assert.strictEqual(parseAgentFrontmatter('no frontmatter'), null);
  });
  it('researcher: role skill path that exists, report-only', () => {
    const lines = roleLines('rig:researcher', PLUGIN_ROOT);
    const skill = path.join(PLUGIN_ROOT, 'skills', 'research', 'SKILL.md');
    assert.ok(lines.some((l) => l.includes(skill)), lines.join('\n'));
    assert.ok(fs.existsSync(skill));
    assert.ok(lines.some((l) => l.startsWith('Report findings only')));
  });
  it('implementer: no skill line, may edit', () => {
    const lines = roleLines('rig:implementer', PLUGIN_ROOT);
    assert.deepStrictEqual(lines, ['## Your role', 'Agent: rig:implementer']);
    assert.strictEqual(isReportOnly(agentDefinitionFor('rig:implementer', PLUGIN_ROOT)), false);
  });
  it('every Rig agent preload resolves to an existing SKILL.md', () => {
    for (const f of fs.readdirSync(path.join(PLUGIN_ROOT, 'agents')).filter((n) => n.endsWith('.md'))) {
      const type = `rig:${f.slice(0, -3)}`;
      const def = agentDefinitionFor(type, PLUGIN_ROOT);
      assert.ok(def, type);
      const named = roleLines(type, PLUGIN_ROOT).filter((l) => l.startsWith('Before starting')).length;
      assert.strictEqual(named, def.skills.length, `${type}: every preload named`);
    }
  });
  it('built-in, unknown and unsafe agent types give nothing', () => {
    for (const t of ['Explore', 'general-purpose', 'rig:nope', 'rig:../x', 'rig:', undefined, 42]) {
      assert.deepStrictEqual(roleLines(t, PLUGIN_ROOT), [], String(t));
    }
  });
  it('agents carry no Team Mode section: the hook is the single source of teammate rules', () => {
    for (const f of fs.readdirSync(path.join(PLUGIN_ROOT, 'agents')).filter((n) => n.endsWith('.md'))) {
      const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'agents', f), 'utf8');
      assert.ok(!/## Team Mode|shutdown_re(quest|sponse)/.test(text), f);
    }
  });
  it('team skill: no per-teammate mode, no removed flags, rules in step with the hook', () => {
    const dir = path.join(PLUGIN_ROOT, 'skills', 'team');
    const all = ['SKILL.md', 'references/team-templates.md', 'references/team-coordination.md']
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    assert.ok(!/mode: ["']plan|--plan-approval|--delegate|shutdown_re(quest|sponse)|broadcast/.test(all));
    const doc = fs.readFileSync(path.join(dir, 'references', 'team-coordination.md'), 'utf8').replace(/`/g, '');
    for (const rule of teamRuleLines().slice(1, 5)) assert.ok(doc.includes(rule.slice(2)), `coordination doc has: ${rule}`);
  });
  it('team rules cover tasks, ownership, messages, reports and shutdown', () => {
    const text = teamRuleLines().join('\n');
    for (const k of ['TaskList', 'TaskUpdate', 'files your task assigns', 'SendMessage', 'Reports', 'shutdown request']) assert.ok(text.includes(k), k);
  });
});
