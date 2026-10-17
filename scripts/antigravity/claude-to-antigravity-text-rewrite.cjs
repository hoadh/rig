/**
 * Pure text rewrites that turn Claude Code kit files (.claude/) into the Antigravity copy (.agent/).
 * No file system access, so every rule can be unit-tested.
 */

// Skills that only work inside Claude Code (headless `claude -p` workers, Agent Teams).
const CLAUDE_ONLY_SKILL_DIRS = new Set(['remote', 'team']);
// Files inside synced skills that only drive Claude Code-only skills (paths under .claude/skills/).
// They are not copied, and lines naming them are dropped from the synced text.
const CLAUDE_ONLY_SKILL_FILES = new Set(['rig-plan/references/multi-machine-planning.md']);

// Rules copied into .agent/rules/. team-coordination-rules.md is Agent Teams only.
const SYNCED_RULE_FILES = [
  'development-rules.md',
  'documentation-management.md',
  'orchestration-protocol.md',
  'primary-workflow.md',
];

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Read `name` and `description` from YAML frontmatter (single-line or `>-`/`|` block scalars). */
function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const lines = match[1].split(/\r?\n/);
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    const m = /^(name|description|user-invocable):\s*(.*)$/.exec(lines[i]);
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

/** `rig:plan` → `plan`, `diataxis-writer` → `diataxis-writer`. Used for skill dirs and workflow names. */
const agentSkillName = (frontmatterName, dirName) => (frontmatterName || dirName).replace(/^rig:/, '').replace(/:/g, '-');

/**
 * Build the rewrite function for one sync run.
 * @param {Map<string,string>} dirRenames - .claude skill dir → .agent skill dir (e.g. rig-plan → plan)
 * @param {Set<string>} knownSkillNames - names that `rig:<name>` references may point to
 */
function createTextRewriter(dirRenames, knownSkillNames) {
  const renamePattern = dirRenames.size
    ? new RegExp(`skills/(${[...dirRenames.keys()].map(escapeRegExp).join('|')})(?=[/\`'"\\s)]|$)`, 'g')
    : null;
  return function rewrite(text) {
    let out = text
      .replace(/(~|\$HOME|\$\{HOME\})\/\.claude\/skills\//g, '.agent/skills/')
      .replace(/\.\/\.claude\//g, './.agent/')
      .replace(/(^|[^\w/~.}-])\.claude\//gm, '$1.agent/');
    if (renamePattern) out = out.replace(renamePattern, (_, dir) => `skills/${dirRenames.get(dir)}`);
    return out.replace(/(?<![\w-])(\/?)rig:([a-z0-9-]+)/g, (whole, slash, name) => (knownSkillNames.has(name) ? `${slash}${name}` : whole));
  };
}

/** Set the `name:` line inside the leading frontmatter block only, leaving every other key and the body untouched. */
const setFrontmatterName = (text, name) => text.replace(/^---\r?\n[\s\S]*?\r?\n---/, (fm) => fm.replace(/^name:.*$/m, `name: ${name}`));

/** Drop a `## Heading` section (up to the next `## ` heading) from markdown. */
function dropSection(text, heading) {
  const start = text.indexOf(`\n## ${heading}\n`);
  if (start === -1) return text;
  const next = text.indexOf('\n## ', start + 1);
  return text.slice(0, start + 1) + (next === -1 ? '' : text.slice(next + 1));
}

/** CLAUDE.md → project instructions for Antigravity (.agent/rules/project-instructions.md and GEMINI.md). */
function convertProjectInstructions(claudeMd, rewrite, title) {
  const body = dropSection(claudeMd, 'Hook Response Protocol')
    .split('\n')
    .filter((line) => !line.includes('DO NOT modify skills in'))
    .join('\n');
  // Header lines are set after convertRule so its CLAUDE.md → GEMINI.md rename does not touch them.
  return convertRule(body, rewrite)
    .replace(/^# GEMINI\.md$/m, `# ${title}`)
    .replace(/^This file provides guidance to Claude Code.*$/m,
      'Project instructions for Antigravity, generated from `CLAUDE.md` by `scripts/sync-antigravity-agent-dir.cjs`. Claude Code concepts are mapped in `.agent/rules/claude-code-concepts-in-antigravity.md`.');
}

/** Rule text: path rewrites plus CLAUDE.md → GEMINI.md. */
const convertRule = (text, rewrite) => rewrite(text).replace(/CLAUDE\.md/g, 'GEMINI.md');

/** Workflow file that triggers a skill via `/<name>`. Description is quoted, YAML-safe and short. */
function buildWorkflow(name, description) {
  let desc = (description || `Run the ${name} skill`).replace(/\s+/g, ' ').trim();
  if (desc.length > 250) desc = `${desc.slice(0, 247).replace(/\s+\S*$/, '')}...`;
  return `---\ndescription: ${JSON.stringify(desc)}\n---\n\n`
    + `Read \`.agent/skills/${name}/SKILL.md\` and follow it.\n\n`
    + `Treat the text after \`/${name}\` as the skill's arguments (\`$ARGUMENTS\`). `
    + 'Claude Code tool names in the skill are mapped in `.agent/rules/claude-code-concepts-in-antigravity.md`.\n';
}

/** Drop every line that names a CLAUDE_ONLY_SKILL_FILES file, so no synced text points at a missing file. */
function dropClaudeOnlyFileLines(text) {
  const names = [...CLAUDE_ONLY_SKILL_FILES].map((f) => f.split('/').pop());
  return text.split('\n').filter((line) => !names.some((n) => line.includes(n))).join('\n');
}

module.exports = {
  CLAUDE_ONLY_SKILL_DIRS,
  CLAUDE_ONLY_SKILL_FILES,
  dropClaudeOnlyFileLines,
  SYNCED_RULE_FILES,
  parseFrontmatter,
  agentSkillName,
  createTextRewriter,
  setFrontmatterName,
  dropSection,
  convertProjectInstructions,
  convertRule,
  buildWorkflow,
};
