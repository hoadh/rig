#!/usr/bin/env node
/**
 * Every agent that tells itself to activate, follow, use, load or invoke a named plugin skill must be able to load it:
 * the skill is preloaded in its frontmatter (`skills: - rig:<name>`), the agent has the `Skill` tool, or the body tells
 * it to read the skill through the bin (`$(rig-skill-dir <name>)/SKILL.md`, for skills needed only now and then).
 * Found live on 2.0.0: git-operator said "Activate `git` skill" with neither, so the skill's exact output lines
 * (clean tree, nothing committed, pushed proof) never reached it.
 * Run: node --test plugins/rig/hooks/__tests__/agent-skill-reachable-scan.test.cjs
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PLUGIN = path.join(__dirname, '..', '..');
const AGENTS = path.join(PLUGIN, 'agents');

/** Frontmatter block, its `tools:` line and `skills:` list, and the body of an agent file. */
function parseAgent(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!m) return null;
  const front = m[1];
  const tools = (/^tools:\s*(.*)$/m.exec(front) || [])[1] || '';
  const skillsBlock = (/^skills:\s*\r?\n((?:\s+-\s+.*\r?\n?)*)/m.exec(front) || [])[1] || '';
  const skills = skillsBlock.split(/\r?\n/).map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
  return { tools, skills, body: m[2] };
}

/**
 * Skill names an agent body tells itself to use: "Activate `git` skill", "follow the `progress` skill",
 * "Use `explore` and `code-review` skills", "use `rig:media` skills".
 */
function namedSkills(body) {
  const out = new Set();
  const name = '`(?:rig:)?([a-z][a-z0-9-]*)`';
  const re = new RegExp(`\\b(?:activate|follow|use|load|invoke)\\s+(?:the\\s+)?${name}(?:\\s*(?:,|and|or)\\s*${name})*\\s+skills?\\b`, 'gi');
  // "Use `a`, `b` and `c` skills": every backticked name inside the match counts
  for (const m of body.matchAll(re)) for (const inner of m[0].matchAll(/`(?:rig:)?([a-z][a-z0-9-]*)`/g)) out.add(inner[1]);
  return [...out];
}

/** Skills the body reads through the bin: `$(rig-skill-dir <name>)/SKILL.md`. */
function readViaBin(body) {
  return new Set([...body.matchAll(/rig-skill-dir\s+([a-z][a-z0-9-]*)/g)].map((m) => m[1]));
}

const pluginSkills = new Set(fs.readdirSync(path.join(PLUGIN, 'skills')).filter((d) => fs.existsSync(path.join(PLUGIN, 'skills', d, 'SKILL.md'))));

describe('agents can load the skills they name', () => {
  const files = fs.readdirSync(AGENTS).filter((f) => f.endsWith('.md'));

  it('finds agent files', () => assert.ok(files.length > 0));

  for (const file of files) {
    it(`${file}: every named plugin skill is preloaded or the Skill tool is available`, () => {
      const agent = parseAgent(fs.readFileSync(path.join(AGENTS, file), 'utf8'));
      assert.ok(agent, `${file} has no frontmatter`);
      const hasSkillTool = /(^|[\s,])Skill\b/.test(agent.tools);
      const viaBin = readViaBin(agent.body);
      const missing = namedSkills(agent.body)
        .filter((name) => pluginSkills.has(name))
        .filter((name) => !hasSkillTool && !agent.skills.includes(`rig:${name}`) && !viaBin.has(name));
      assert.deepStrictEqual(missing, [], `${file} names skill(s) it cannot load: ${missing.join(', ')}; preload them under "skills:" as rig:<name>, or for an occasional skill tell the agent to read $(rig-skill-dir <name>)/SKILL.md`);
    });
  }

  it('preloaded skills exist in the plugin', () => {
    for (const file of files) {
      const agent = parseAgent(fs.readFileSync(path.join(AGENTS, file), 'utf8'));
      for (const s of agent.skills) {
        assert.ok(s.startsWith('rig:') && pluginSkills.has(s.slice(4)), `${file}: unknown preloaded skill ${s}`);
      }
    }
  });

  it('detects the bug it guards against (fixture)', () => {
    const agent = parseAgent('---\nname: x\ntools: Read, Bash\n---\nActivate `git` skill.\n');
    assert.deepStrictEqual(namedSkills(agent.body), ['git']);
    assert.deepStrictEqual(agent.skills, []);
    assert.deepStrictEqual(namedSkills('Use `explore` and `code-review` skills. use `rig:media` skills'), ['explore', 'code-review', 'media']);
    assert.ok(readViaBin('read `$(rig-skill-dir browser)/SKILL.md`').has('browser'));
  });
});
