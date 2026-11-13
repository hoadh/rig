/**
 * Maps a Claude Code agent file to an Antigravity plugin agent (native manifest mode).
 * Native mode rejects Claude frontmatter such as `tools: Glob, Grep` (a string where a list is expected), so the
 * frontmatter is rebuilt from the few keys that carry over:
 *   name, description  kept verbatim (block scalars included)
 *   skills             kept as a YAML list, without the `rig:` prefix
 *   model              always `inherit`; Claude model names mean nothing here
 *   tools              mapped to an Antigravity allowlist (TOOL_MAP); no `tools` key = all tools
 *   subagent: true, mainAgent: false
 * `effort`, `memory` and every other key are dropped. The body is returned untouched. Pure text in, text out.
 *
 * Tool names, checked live on agy 1.5.4 (CLI): run_command, read_file, write_file, edit_file, search_web,
 * invoke_subagent, send_message, ask_question, manage_task. `send_message` and `manage_task` are always
 * granted. IDE-only names (grep_search, find_by_name, send_command_input, read_url_content) are ignored by
 * the CLI. `view_file` is not used: next to `read_file` it fails with "tool name conflict".
 */

const KEY_LINE = /^([A-Za-z_][\w-]*)\s*:(?:\s|$)/;

/** Claude Code tool → Antigravity tools. Unknown Claude tools (MCP resource tools, ...) map to nothing. */
const TOOL_MAP = {
  Read: ['read_file'],
  Glob: ['find_by_name'],
  Grep: ['grep_search'],
  Bash: ['run_command', 'send_command_input'],
  Write: ['write_file'],
  Edit: ['edit_file'],
  MultiEdit: ['edit_file'],
  NotebookEdit: ['edit_file'],
  WebSearch: ['search_web'],
  WebFetch: ['read_url_content'],
  Agent: ['invoke_subagent'],
  Task: ['invoke_subagent'],
  AskUserQuestion: ['ask_question'],
  TaskCreate: ['manage_task'],
  TaskGet: ['manage_task'],
  TaskUpdate: ['manage_task'],
  TaskList: ['manage_task'],
  SendMessage: ['send_message'],
};

/** Antigravity allowlist for a `tools:` block (comma string, inline list or YAML list), in first-seen order. */
function toolList(block) {
  const first = block.lines[0].replace(/^tools:\s*/, '');
  const raw = first.trim()
    ? first.replace(/^\[|\]$/g, '').split(',')
    : block.lines.slice(1).map((l) => (/^\s*-\s*(.+?)\s*$/.exec(l) || [])[1]).filter(Boolean);
  const out = [];
  for (const name of raw.map((t) => t.trim().replace(/^['"]|['"]$/g, ''))) {
    for (const tool of TOOL_MAP[name] || []) if (!out.includes(tool)) out.push(tool);
  }
  return out;
}

/** Split the leading frontmatter into top-level blocks `{ key, lines }`; null without frontmatter. */
function parseBlocks(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return null;
  const blocks = [];
  for (const line of match[1].split(/\r?\n/)) {
    const key = KEY_LINE.exec(line);
    if (key) blocks.push({ key: key[1], lines: [line] });
    else if (blocks.length) blocks[blocks.length - 1].lines.push(line);
  }
  return { blocks, rest: text.slice(match[0].length) };
}

/** Skill names of a `skills:` block (list items or an inline `[a, b]`), `rig:` prefix removed. */
function skillList(block) {
  const inline = /^skills:\s*\[(.*)\]\s*$/.exec(block.lines[0]);
  const items = inline
    ? inline[1].split(',')
    : block.lines.slice(1).map((l) => /^\s*-\s*(.+?)\s*$/.exec(l)).filter(Boolean).map((m) => m[1]);
  return items.map((i) => i.trim().replace(/^['"]|['"]$/g, '').replace(/^rig:/, '')).filter(Boolean);
}

/** @param {string} text agent Markdown; @returns {string} Antigravity agent Markdown */
function mapAgentFrontmatter(text) {
  const parsed = parseBlocks(text);
  if (!parsed) throw new Error('agent file has no frontmatter');
  const byKey = new Map(parsed.blocks.map((b) => [b.key, b]));
  for (const required of ['name', 'description']) {
    if (!byKey.has(required)) throw new Error(`agent frontmatter has no "${required}"`);
  }
  const out = [...byKey.get('name').lines, ...byKey.get('description').lines, 'model: inherit'];
  const skills = byKey.has('skills') ? skillList(byKey.get('skills')) : [];
  if (skills.length) out.push('skills:', ...skills.map((s) => `  - ${s}`));
  const tools = byKey.has('tools') ? toolList(byKey.get('tools')) : [];
  if (tools.length) out.push('tools:', ...tools.map((t) => `  - ${t}`));
  out.push('subagent: true', 'mainAgent: false');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return `---${eol}${out.join(eol)}${eol}---${parsed.rest}`;
}

module.exports = { mapAgentFrontmatter };
