'use strict';
/**
 * teammate-role-context.cjs - the Rig part of an Agent Teams teammate's context: its role skill and its team rules.
 *
 * Claude Code applies a subagent definition's tools, model and body to a teammate, but NOT its `skills:` preloads
 * (agent teams docs, "Use subagent definitions for teammates"). So a `rig:researcher` teammate would start without the
 * `research` skill. This module reads the member's Rig agent file and names the SKILL.md to read instead.
 * The team rules here replace the "Team Mode" section the agents used to carry: only teammates get them.
 * Read-only, no dependencies; returns empty results for built-in or unknown agent types.
 */
const fs = require('fs');
const path = require('path');

const AGENT_NAME = /^[a-z][a-z0-9-]{0,63}$/;
const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit'];

/** Frontmatter `tools` (comma list) and `skills` (YAML list or inline) of an agent file; null when unreadable. */
function parseAgentFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || ''));
  if (!m) return null;
  const lines = m[1].split(/\r?\n/);
  const out = { tools: null, skills: [] };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const tools = /^tools:\s*(.*)$/.exec(line);
    if (tools) out.tools = tools[1].split(',').map((t) => t.trim()).filter(Boolean);
    const skills = /^skills:\s*(.*)$/.exec(line);
    if (skills) {
      const inline = skills[1].trim();
      if (inline.startsWith('[')) out.skills = inline.replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
      else for (let j = i + 1; j < lines.length && /^\s+-\s*/.test(lines[j]); j++) out.skills.push(lines[j].replace(/^\s+-\s*/, '').trim());
    }
  }
  out.skills = out.skills.map((s) => s.replace(/^["']|["']$/g, ''));
  return out;
}

/**
 * The Rig agent definition behind a teammate's agent type (`rig:<name>`), or null for built-in/other agents.
 * @returns {null | {name: string, tools: string[]|null, skills: string[]}}
 */
function agentDefinitionFor(agentType, pluginRoot) {
  if (typeof agentType !== 'string' || !agentType.startsWith('rig:')) return null;
  const name = agentType.slice(4);
  if (!AGENT_NAME.test(name)) return null;
  try {
    const def = parseAgentFrontmatter(fs.readFileSync(path.join(pluginRoot, 'agents', `${name}.md`), 'utf8'));
    return def ? { name, ...def } : null;
  } catch {
    return null;
  }
}

/** Absolute SKILL.md paths of the definition's `rig:<skill>` preloads that exist in this plugin. */
function roleSkillFiles(def, pluginRoot) {
  if (!def) return [];
  return def.skills
    .filter((s) => /^rig:[a-z][a-z0-9-]{0,63}$/.test(s))
    .map((s) => path.join(pluginRoot, 'skills', s.slice(4), 'SKILL.md'))
    .filter((f) => fs.existsSync(f));
}

/** True when the definition limits tools and none of them edits files. */
function isReportOnly(def) {
  return Boolean(def && Array.isArray(def.tools) && !def.tools.some((t) => EDIT_TOOLS.includes(t)));
}

/** `## Your role` lines for a teammate, or [] when there is nothing Rig-specific to say. */
function roleLines(agentType, pluginRoot) {
  const def = agentDefinitionFor(agentType, pluginRoot);
  if (!def) return [];
  const lines = ['## Your role', `Agent: ${agentType}`];
  for (const file of roleSkillFiles(def, pluginRoot)) {
    lines.push(`Before starting, read ${file} (your role skill; teammates do not get an agent's skill preloads).`);
  }
  if (isReportOnly(def)) lines.push('Report findings only: do not change project files (your report file is fine).');
  return lines;
}

/** `## Team rules`, the single source of the teammate rules (skills/team/references/team-coordination.md matches it). */
function teamRuleLines() {
  return [
    '## Team rules',
    '- Your task is in your spawn prompt. If TaskList is available: check it, claim your assigned or the lowest-ID unblocked task with TaskUpdate (owner = your name, in_progress), read it with TaskGet.',
    '- Edit only the files your task assigns to you. Need another file: message its owner or the lead first.',
    '- If TaskUpdate is available, mark the task completed before you report. Not done: say why instead.',
    '- Message teammates and the lead by name with SendMessage, one message per recipient.',
    '- Reports go to the Reports path in Rig Context (default plans/reports/): concise, unresolved questions last.',
    '- On a shutdown request: finish the current step, update your task, then approve.',
  ];
}

module.exports = { parseAgentFrontmatter, agentDefinitionFor, roleSkillFiles, isReportOnly, roleLines, teamRuleLines };
