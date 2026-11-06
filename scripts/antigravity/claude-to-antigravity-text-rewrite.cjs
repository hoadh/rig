/**
 * Pure text rewrites that turn Claude Code kit files (plugins/rig/) into the Antigravity copy (.agent/).
 * No file system access, so every rule can be unit-tested.
 */

// Skills that only work inside Claude Code (headless `claude -p` workers, Agent Teams, plugin setup via rig-init).
const CLAUDE_ONLY_SKILL_DIRS = new Set(['remote', 'setup', 'team']);
// Files inside synced skills that only drive Claude Code-only skills (paths under plugins/rig/skills/).
// They are not copied, and lines naming them are dropped from the synced text.
const CLAUDE_ONLY_SKILL_FILES = new Set(['plan/references/multi-machine-planning.md']);

// plugins/rig/scripts/ files copied to .agent/scripts/ (the docs validator and migrator, with the helpers they require).
// Everything else in that dir needs Claude Code hooks, the plugin runtime or the Claude Code env layout.
const AGENT_SCRIPT_FILES = [
  'validate-docs.cjs',
  'docs-diataxis-layout.cjs',
  'migrate-docs-to-diataxis-layout.cjs',
  'migrate-docs-custom-move-map-parser.cjs',
  'migrate-docs-link-rewrite-helpers.cjs',
];

// Rules copied into .agent/rules/. Task-specific rules live in skill references and ship with the skills.
const SYNCED_RULE_FILES = ['core-rules.md'];

// Claude Code kit text calls plugin bin/ commands by name (`rig-worktree`); Antigravity has no PATH entry for them,
// so the ones whose script ships inside a synced skill go back to the script path in .agent/skills/.
const BIN_COMMANDS_IN_SKILLS = new Map([
  ['rig-worktree', 'node .agent/skills/worktree/scripts/worktree.cjs'],
  ['rig-markdown-viewer', 'node .agent/skills/markdown-viewer/scripts/server.cjs'],
  ['rig-classify-doc', 'bash .agent/skills/diataxis-writer/scripts/classify-doc.sh'],
  ['rig-ui-search', 'python .agent/skills/ui-design/scripts/search.py'],
  ['rig-mcp', 'node .agent/skills/mcp/scripts/dist/cli.js'],
  // Scripts the sync copies into .agent/scripts/ (AGENT_SCRIPT_FILES), since they live in plugins/rig/scripts/.
  ['rig-validate-docs', 'node .agent/scripts/validate-docs.cjs'],
  ['rig-migrate-docs', 'node .agent/scripts/migrate-docs-to-diataxis-layout.cjs'],
  // install.sh builds the venv next to the skills.
  ['rig-python', '.agent/skills/.venv/bin/python3'],
]);
const BIN_COMMAND_PATTERN = new RegExp(`(?<![\\w./$-])(${[...BIN_COMMANDS_IN_SKILLS.keys()].join('|')})(?![\\w.-])`, 'g');

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

// No Antigravity equivalent, so the command is replaced by a note (set-active-plan feeds Claude Code hooks)
// or its line is dropped (resolve_env.py hard-codes the Claude Code .env lookup paths, so it is not copied).
const ACTIVE_PLAN_NOTE = 'no command needed: Antigravity has no active-plan marker, keep the plan path in your notes';
const bareBin = (name) => `(?<![\\w./$-])${name}(?![\\w.-])`;
const ACTIVE_PLAN_INLINE = new RegExp(`\`${bareBin('rig-set-active-plan')}[^\`]*\``, 'g');
const ACTIVE_PLAN_LINE = new RegExp(`^([ \\t]*)(?:\\$ )?${bareBin('rig-set-active-plan')}.*$`, 'gm');
const RESOLVE_ENV_LINE = new RegExp(`^.*${bareBin('rig-resolve-env')}.*(?:\\r?\\n|$)`, 'gm');

/**
 * Build the rewrite function for one sync run.
 * @param {Map<string,string>} dirRenames - .claude skill dir → .agent skill dir (e.g. rig-plan → plan)
 * @param {Set<string>} knownSkillNames - names that `rig:<name>` references may point to
 */
function createTextRewriter(dirRenames, knownSkillNames) {
  const renamePattern = dirRenames.size
    ? new RegExp(`skills/(${[...dirRenames.keys()].map(escapeRegExp).join('|')})(?=[/\`'"\\s)]|$)`, 'g')
    : null;
  /** @param {{skillName?: string}} [ctx] skillName: the .agent skill dir a file belongs to, for `${CLAUDE_SKILL_DIR}`. */
  return function rewrite(text, ctx = {}) {
    let out = text
      .replace(/(~|\$HOME|\$\{HOME\})\/\.claude\/skills\//g, '.agent/skills/')
      .replace(/\.\/\.claude\//g, './.agent/')
      .replace(/(^|[^\w/~.}-])\.claude\//gm, '$1.agent/')
      .replace(/(^|[^\w/~.}-])\.claude\\/gm, '$1.agent\\')
      .replace(/(<project>|\$SKILL_DIR)\/\.claude\/browser\//g, '$1/.agent/browser/')
      .replace(/<kit>(?=[/\\])/g, '.agent');
    if (ctx.skillName) out = out.replace(/\$\{CLAUDE_SKILL_DIR\}/g, `.agent/skills/${ctx.skillName}`);
    if (renamePattern) out = out.replace(renamePattern, (_, dir) => `skills/${dirRenames.get(dir)}`);
    out = out.replace(/\$\(rig-browser --dir\)/g, '.agent/skills/browser/scripts')
      .replace(/(?<![\w./$-])rig-browser (?!--dir)([a-z][a-z-]*)(?![\w.-])/g, 'node .agent/skills/browser/scripts/$1.js')
      .replace(/\$\(rig-skill-dir ([a-z][a-z0-9-]*)\)|(?<![\w./$-])rig-skill-dir ([a-z][a-z0-9-]*)(?![\w.-])/g, (_, a, b) => `.agent/skills/${a || b}`)
      .replace(new RegExp(`${bareBin('rig-browser')} --dir`, 'g'), '.agent/skills/browser/scripts')
      .replace(new RegExp(`${bareBin('rig-browser')} <script>`, 'g'), 'node .agent/skills/browser/scripts/<script>.js')
      .replace(BIN_COMMAND_PATTERN, (_, name) => BIN_COMMANDS_IN_SKILLS.get(name))
      .replace(ACTIVE_PLAN_INLINE, ACTIVE_PLAN_NOTE)
      .replace(ACTIVE_PLAN_LINE, `$1# ${ACTIVE_PLAN_NOTE}`)
      .replace(RESOLVE_ENV_LINE, '');
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

/** Demote markdown headings by one level (`##` → `###`) outside code fences, so a file can nest under a heading. */
function demoteHeadings(text) {
  let fenced = false;
  return text.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    return !fenced && /^#{2,5} /.test(line) ? `#${line}` : line;
  }).join('\n');
}

/**
 * GEMINI.md: core rules + project instructions (CLAUDE.md) + a pointer to the concept mapping.
 * Antigravity has no SessionStart hook to inject the core rules, so they are part of this always-loaded file.
 */
function buildGeminiMd(coreRules, claudeMd, rewrite) {
  const core = convertRule(coreRules, rewrite).replace(/^# .*\n+/, '').trim();
  const project = convertRule(dropSection(claudeMd, 'Hook Response Protocol')
    .split('\n')
    .filter((line) => !line.includes('DO NOT modify skills in'))
    .join('\n'), rewrite)
    .replace(/^# .*\n+/, '')
    .replace(/^(This file provides guidance to|Guidance for) Claude Code.*\n+/m, '')
    .trim();
  return [
    '# GEMINI.md',
    '',
    'Instructions for Antigravity, generated from the Rig plugin core rules and `CLAUDE.md` by `scripts/sync-antigravity-agent-dir.cjs`. Do not edit by hand.',
    '',
    '## Core rules',
    '',
    core,
    '',
    '## Project instructions',
    '',
    demoteHeadings(project),
    '',
    '## Claude Code concepts',
    '',
    'These instructions and the files in `.agent/` name Claude Code tools (subagents, `AskUserQuestion`, hooks). `.agent/rules/claude-code-concepts-in-antigravity.md` maps each one to what to do in Antigravity.',
    '',
  ].join('\n');
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
  buildGeminiMd,
  demoteHeadings,
  AGENT_SCRIPT_FILES,
  convertRule,
  buildWorkflow,
};
