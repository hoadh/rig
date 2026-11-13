/**
 * Maps a Claude Code agent file to an Antigravity plugin agent (native manifest mode).
 * Native mode rejects Claude frontmatter such as `tools: Glob, Grep` (a string where a list is expected), so the
 * frontmatter is rebuilt from the few keys that carry over:
 *   name, description  kept verbatim (block scalars included)
 *   skills             kept as a YAML list, without the `rig:` prefix
 *   model              always `inherit`; Claude model names mean nothing here
 *   subagent: true, mainAgent: false
 * `tools`, `effort`, `memory` and every other key are dropped (the subagent inherits the parent's tools).
 * The body is returned untouched. Pure text in, text out.
 */

const KEY_LINE = /^([A-Za-z_][\w-]*)\s*:(?:\s|$)/;

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
  out.push('subagent: true', 'mainAgent: false');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return `---${eol}${out.join(eol)}${eol}---${parsed.rest}`;
}

module.exports = { mapAgentFrontmatter };
