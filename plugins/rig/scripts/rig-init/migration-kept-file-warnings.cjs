'use strict';
/**
 * Read-only warnings about files a 1.x migration keeps that will misbehave after it:
 *   - a kept CLAUDE.md that points at paths the migration moves (a 1.x CLAUDE.md lists the 1.x rules files under the Claude Code config dir;
 *     after the move those references dangle and the instructions in them are gone from the session);
 *   - a kept user skill whose `name:` is a plugin skill's name (`rig:<x>`): Claude Code lists both.
 * Neither blocks or changes the migration; both show in `--plan`, `--plan --json` and the confirmation prompt.
 */
const fs = require('fs');
const path = require('path');

const PLUGIN_SKILLS_DIR = path.resolve(__dirname, '..', '..', 'skills');

const MAX_CLAUDE_MD_BYTES = 1024 * 1024; // a CLAUDE.md beyond this is skipped, not read whole

function readText(file, maxBytes = Infinity) {
  try {
    if (maxBytes !== Infinity && fs.statSync(file).size > maxBytes) return null;
    return fs.readFileSync(file, 'utf8');
  } catch { return null; }
}

/** `name:` from a SKILL.md frontmatter (BOM, quotes and a trailing `# comment` tolerated), or null. */
function skillName(text) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || '').replace(/^\uFEFF/, ''));
  const m = front && /^name:\s*(.*)$/m.exec(front[1]);
  if (!m) return null;
  const value = m[1].replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '').trim();
  return value || null;
}

/** Names the plugin's skills are listed under (`rig:<name>`). */
function pluginSkillNames(skillsDir = PLUGIN_SKILLS_DIR) {
  const names = new Set();
  let dirs;
  try { dirs = fs.readdirSync(skillsDir); } catch { return names; }
  for (const dir of dirs) {
    const name = skillName(readText(path.join(skillsDir, dir, 'SKILL.md')));
    if (name) names.add(name.startsWith('rig:') ? name : `rig:${name}`);
  }
  return names;
}

/** CLAUDE.md files that belong to the target (the global one, or the project's two), one entry per real file. */
function claudeMdFiles(kind, root, claudeDir) {
  const candidates = kind === 'global' ? [path.join(claudeDir, 'CLAUDE.md')] : [path.join(root, 'CLAUDE.md'), path.join(claudeDir, 'CLAUDE.md')];
  const seen = new Set();
  return candidates.filter((file) => {
    let real;
    try { real = fs.realpathSync(file); } catch { return false; }
    if (seen.has(real)) return false;
    seen.add(real);
    return true;
  });
}

const norm = (p) => path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/**
 * Which install a `.claude/` reference points at, from the text right before it: `~`, `$HOME`, `${HOME}`,
 * `%USERPROFILE%` or the absolute home path mean the global install; nothing, `./`, `$CLAUDE_PROJECT_DIR` or an absolute
 * path under the project root mean the project install; any other absolute path means neither.
 */
function refScope(before, { home, root }) {
  const token = (/[^\s`'"(<>[\]=,]*$/.exec(before) || [''])[0].replace(/[/\\]+$/, '');
  if (token === '' || token === '.' || /CLAUDE_PROJECT_DIR/.test(token)) return 'project';
  if (/^~$|\$\{?HOME\}?$|%USERPROFILE%$/i.test(token)) return 'global';
  if (/^(?:[A-Za-z]:)?[/\\]/.test(token)) {
    if (home && norm(token) === norm(home)) return 'global';
    if (root && (norm(token) === norm(root) || norm(token).startsWith(`${norm(root)}/`))) return 'project';
  }
  return 'other';
}

/** `ref` without trailing sentence punctuation (a loop: a regex here is quadratic on long runs). */
function trimRef(ref) {
  let end = ref.length;
  while (end > 0 && '.,;:)'.includes(ref[end - 1])) end--;
  return ref.slice(0, end);
}

/**
 * References in a CLAUDE.md to paths the migration moves, only those that point at this target's install (`kind`):
 * the file itself, files below a directory or a `*` pattern (`rules/*`), or a file inside a moved directory.
 * @param {string} text
 * @param {{rel:string, type?:string}[]} moves
 * @param {{kind:string, home?:string, root?:string}} scope
 * @returns {{ref:string, moved:number}[]} one entry per distinct reference that hits, in text order
 */
function movedPathsReferenced(text, moves, scope) {
  const rels = moves.map((m) => m.rel);
  const dirRels = moves.filter((m) => m.type === 'dir').map((m) => m.rel);
  const out = new Map();
  const seen = new Set();
  for (const m of text.matchAll(/\.claude[/\\]([A-Za-z0-9_.*\-/\\]+)/g)) {
    const ref = trimRef(m[1].replace(/\\/g, '/'));
    if (!ref || seen.has(ref)) continue;
    if (refScope(text.slice(Math.max(0, m.index - 260), m.index), scope) !== scope.kind) continue;
    seen.add(ref);
    const prefix = ref.includes('*') ? ref.slice(0, ref.indexOf('*')) : `${ref.replace(/\/$/, '')}/`;
    const moved = rels.filter((rel) => rel === ref || rel.startsWith(prefix)).length
      + dirRels.filter((dir) => ref.startsWith(`${dir}/`)).length;
    if (moved) out.set(ref, moved);
  }
  return [...out].map(([ref, moved]) => ({ ref, moved }));
}

/**
 * @param {{kind:string, root:string, claudeDir:string, moves:{rel:string}[]}} plan
 * @param {{pluginSkills?: Set<string>}} [opts]
 * @returns {string[]} warning lines (no leading "warning:")
 */
function keptFileWarnings(plan, { pluginSkills = pluginSkillNames() } = {}) {
  const warnings = [];
  const moved = new Set(plan.moves.map((m) => m.rel));
  const scope = { kind: plan.kind, home: plan.kind === 'global' ? path.dirname(plan.claudeDir) : plan.home, root: plan.root };
  for (const file of claudeMdFiles(plan.kind, plan.root, plan.claudeDir)) {
    const text = readText(file, MAX_CLAUDE_MD_BYTES);
    if (!text) continue;
    const refs = movedPathsReferenced(text, plan.moves, scope);
    if (refs.length) {
      const label = ({ ref, moved }) => (moved === 1 && !ref.endsWith('/') && !ref.includes('*') ? ref : `${ref} (${moved} files)`);
      const shown = refs.slice(0, 6).map(label).join(', ') + (refs.length > 6 ? `, +${refs.length - 6} more` : '');
      warnings.push(`${file} refers to ${refs.length} path(s) this migration moves: ${shown}. Edit it after the migration: the plugin injects the core rules itself, and the moved files stay in the backup.`);
    }
  }
  let skillDirs = [];
  try { skillDirs = fs.readdirSync(path.join(plan.claudeDir, 'skills')); } catch { /* no skills dir */ }
  for (const dir of skillDirs.sort()) {
    const rel = `skills/${dir}/SKILL.md`;
    if (moved.has(rel)) continue;
    const name = skillName(readText(path.join(plan.claudeDir, 'skills', dir, 'SKILL.md')));
    if (name && pluginSkills.has(name)) {
      warnings.push(`kept skill skills/${dir} is named ${name}, like a plugin skill; Claude Code lists both. Remove it if it is an old Rig copy.`);
    }
  }
  return warnings;
}

module.exports = { keptFileWarnings, movedPathsReferenced, pluginSkillNames, skillName };
