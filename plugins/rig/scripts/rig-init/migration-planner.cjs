'use strict';
/**
 * Read-only planner for the 1.x -> plugin migration. For each target (the global `~/.claude`, and the project
 * `<dir>/.claude`) it lists:
 *   - `settings`: the Rig hook handlers and statusLine that would be removed from settings.json / settings.local.json
 *   - `moves`: the owned paths (fixed list + generated dirs) that would be moved into the backup
 *   - `kept`: files inside Rig directories that are not on the owned list (the user's own, never moved)
 *   - `committed`: how many of the moves are tracked by git (a team project: the removal must be committed)
 * Nothing is written. `planTarget` and `planAll` are what `rig-init --plan` prints.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const owned = require('./rig-1x-owned-paths.cjs');
const { readJsonFile, backupsDirFor } = require('./backup-restore-standalone.cjs');
const { stripRigSettings } = require('./settings-rig-entries-stripper.cjs');
const { hasRig1xMarker } = require('../../hooks/lib/rig-1x-copy-notice.cjs');
const { keptFileWarnings } = require('./migration-kept-file-warnings.cjs');

const SETTINGS_FILES = ['settings.json', 'settings.local.json'];
const SIZE_WALK_CAP = 200000; // entries; a node_modules tree is sized approximately beyond this

/** Stable id of a project dir for the backup path (realpath, so symlinked checkouts share one). */
function projectHash(root) {
  let real = root;
  try { real = fs.realpathSync(root); } catch { /* not on disk: hash the given path */ }
  return crypto.createHash('sha256').update(owned.norm(real)).digest('hex').slice(0, 12);
}

const backupGroupDir = (home, kind, root) => path.join(backupsDirFor(home), kind === 'global' ? 'global' : projectHash(root));

function lstatOrNull(p) {
  try { return fs.lstatSync(p); } catch { return null; }
}

/** Total bytes under `p` (files only, symlinks counted as links); `budget.left` bounds the walk. */
function sizeOf(p, budget) {
  const st = lstatOrNull(p);
  if (!st) return 0;
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const name of fs.readdirSync(p)) {
    if (budget.left-- <= 0) return total;
    total += sizeOf(path.join(p, name), budget);
  }
  return total;
}

/** Directories (relative to `.claude`) that hold an owned `.py` file: only there is a `__pycache__` Rig's. */
function ownedPythonDirs() {
  const dirs = new Set();
  for (const rel of owned.OWNED_FILES) if (rel.endsWith('.py')) dirs.add(path.posix.dirname(rel));
  return dirs;
}
const OWNED_PY_DIRS = ownedPythonDirs();

/** A generated dir is Rig's only beside the owned file that makes it: node_modules next to an owned package.json, __pycache__ next to an owned .py. */
function isRigGeneratedDir(parentRel, name, childRel) {
  if (owned.GENERATED_DIR_PATHS.includes(childRel)) return true;
  if (name === 'node_modules') return owned.isOwnedFile(`${parentRel}/package.json`);
  if (name === '__pycache__') return OWNED_PY_DIRS.has(parentRel);
  return false;
}

/**
 * Walk a directory below `.claude`: Rig-generated dirs become dir moves, files off the owned list are "kept" (the
 * user's own); a symlinked entry is never followed. `rel` is the posix path below `.claude`.
 */
function walk(claudeDir, rel, out) {
  const abs = path.join(claudeDir, ...rel.split('/'));
  let names;
  try { names = fs.readdirSync(abs); } catch { return; }
  for (const name of names) {
    const childRel = `${rel}/${name}`;
    const st = lstatOrNull(path.join(abs, name));
    if (!st) continue;
    if (st.isDirectory() && !st.isSymbolicLink()) {
      if (isRigGeneratedDir(rel, name, childRel)) out.generated.push(childRel);
      else if (!owned.GENERATED_DIR_NAMES.has(name)) walk(claudeDir, childRel, out); // someone else's node_modules is not walked
    } else if (name === 'package-lock.json' && owned.isOwnedFile(`${rel}/package.json`)) {
      out.generatedFiles.push(childRel); // written by the `npm install` of a Rig skill
    } else if (!owned.isOwnedFile(childRel) && !owned.GENERATED_FILES.includes(childRel) && !/^(\.DS_Store|Thumbs\.db)$/.test(name)) {
      out.kept.push(childRel);
    }
  }
}

/** Tracked files below `.claude` in the project's git repo; empty when not a repo (or git missing). */
function trackedClaudeFiles(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z', '--', '.claude'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
    return new Set(out.split('\0').filter(Boolean).map((p) => p.replace(/^\.claude\//, '')));
  } catch {
    return new Set();
  }
}

/** The newest incomplete journal dir for a target, or null. Backups are `<group>/<ts>/journal.json`. */
function findIncompleteBackup({ home, kind, root }) {
  const group = backupGroupDir(home, kind, root);
  let names;
  try { names = fs.readdirSync(group).sort().reverse(); } catch { return null; }
  for (const name of names) {
    try {
      const journal = readJsonFile(path.join(group, name, 'journal.json')).value;
      if (journal && journal.status !== 'done') return path.join(group, name);
    } catch { /* unreadable journal: not resumable */ }
  }
  return null;
}

/** Directories under `.claude` that hold owned files: top dirs and Rig skill dirs. A symlink or junction there is a blocker. */
function ownedParentDirs() {
  return [...owned.SCAN_TOP_DIRS, ...[...owned.ownedUnitDirs()].filter((d) => d.startsWith('skills/'))];
}

function symlinkBlockers(claudeDir) {
  const blockers = [];
  const claudeSt = lstatOrNull(claudeDir);
  if (claudeSt && claudeSt.isSymbolicLink()) blockers.push(`${claudeDir} is a symlink or junction; rig-init does not follow it. Migrate by hand or replace it with a real directory.`);
  let realClaude = claudeDir;
  try { realClaude = fs.realpathSync(claudeDir); } catch { /* checked above */ }
  for (const rel of ownedParentDirs()) {
    const abs = path.join(claudeDir, ...rel.split('/'));
    const st = lstatOrNull(abs);
    if (!st) continue;
    let real = abs;
    try { real = fs.realpathSync(abs); } catch { /* dangling: reported through the symlink test */ }
    if (st.isSymbolicLink() || owned.norm(real) !== owned.norm(path.join(realClaude, ...rel.split('/')))) {
      blockers.push(`.claude/${rel} is a symlink or junction (to ${real}); rig-init never moves what it points at. Replace the link with a real directory (or remove the link) and run the plan again.`);
    }
  }
  return blockers;
}

/** Every string under `value`, with its JSON path, skipping the `permissions` rules (patterns, not commands). */
function* stringsOf(value, trail = '') {
  if (typeof value === 'string') yield [trail, value];
  else if (Array.isArray(value)) for (const [i, v] of value.entries()) yield* stringsOf(v, `${trail}[${i}]`);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) if (k !== 'permissions') yield* stringsOf(v, trail ? `${trail}.${k}` : k);
  }
}

/** Files other than settings that can start a Rig file: the project's .mcp.json, and mcpServers in ~/.claude.json (global). */
function mcpSources(kind, targetRoot) {
  const out = [];
  const read = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
  if (kind === 'project') {
    const j = read(path.join(targetRoot, '.mcp.json'));
    if (j) out.push({ file: '.mcp.json', value: j });
  } else {
    const j = read(path.join(targetRoot, '.claude.json'));
    if (j) {
      const servers = { user: j.mcpServers || {}, ...Object.fromEntries(Object.entries(j.projects || {}).map(([k, v]) => [k, (v && v.mcpServers) || {}])) };
      out.push({ file: '.claude.json', value: { mcpServers: servers } });
    }
  }
  return out;
}

/**
 * Settings that still mention a path the migration moves, after the Rig entries are removed (a hook that fails with
 * MODULE_NOT_FOUND on every event is the failure the journal order exists to prevent). Each one is a blocker: the user
 * removes or repoints it; nothing is left in place silently.
 */
function dangling(target, claudeDir, moveRels, strippedSettings, mcp) {
  const dirs = moveRels.dirs;
  const isMoved = (rel) => moveRels.files.has(rel) || dirs.some((d) => rel === d || rel.startsWith(`${d}/`));
  const blockers = [];
  const scan = (file, value) => {
    for (const [trail, text] of stringsOf(value)) {
      for (const rel of owned.referencedRels(text, target)) {
        if (isMoved(rel)) blockers.push(`${file} ${trail} runs or reads .claude/${rel}, which the migration moves into the backup. Remove or repoint it, then run the plan again.`);
      }
    }
  };
  for (const { file, settings } of strippedSettings) scan(`.claude/${file}`, settings);
  for (const { file, value } of mcp) scan(file, value);
  return [...new Set(blockers)];
}

/**
 * @param {{kind: 'global'|'project', root: string, home: string}} opts root = the project dir (project) or ignored (global)
 * @returns {object|null} null when there is no `.claude` dir
 */
function planTarget({ kind, root, home }) {
  const targetRoot = kind === 'global' ? home : root;
  const claudeDir = path.join(targetRoot, '.claude');
  if (!lstatOrNull(claudeDir)) return null;
  const target = { kind, root: targetRoot };
  const blockers = symlinkBlockers(claudeDir);
  const identified = hasRig1xMarker(claudeDir);

  const settings = [];
  const stripped = [];
  for (const file of SETTINGS_FILES) {
    const abs = path.join(claudeDir, file);
    let read;
    try {
      read = readJsonFile(abs);
    } catch (err) {
      blockers.push(err.message);
      continue;
    }
    if (!read.exists) continue;
    const { settings: after, removedHooks, removedStatusLine } = stripRigSettings(read.value, target);
    stripped.push({ file, settings: after });
    if (removedHooks.length || removedStatusLine) {
      settings.push({
        file,
        removeHooks: removedHooks.map((h) => ({ event: h.event, command: h.handler.command })),
        removeStatusLine: removedStatusLine ? removedStatusLine.command : null,
      });
    }
  }

  const found = { generated: [], generatedFiles: [], kept: [] };
  for (const rel of owned.GENERATED_DIR_PATHS) if (lstatOrNull(path.join(claudeDir, ...rel.split('/')))) found.generated.push(rel);
  const units = owned.ownedUnitDirs();
  for (const dir of owned.SCAN_TOP_DIRS) {
    if (dir !== 'skills') { if (units.has(dir)) walk(claudeDir, dir, found); continue; }
    // skills/: only Rig's own skill dirs are scanned (the user's other skills are not ours to report)
    for (const unit of units) if (unit.startsWith('skills/')) walk(claudeDir, unit, found);
    const names = (() => { try { return fs.readdirSync(path.join(claudeDir, 'skills')); } catch { return []; } })();
    for (const name of names) {
      const rel = `skills/${name}`;
      const st = lstatOrNull(path.join(claudeDir, 'skills', name));
      if (st && st.isFile() && !owned.isOwnedFile(rel) && !owned.GENERATED_FILES.includes(rel) && !/^(\.DS_Store|Thumbs\.db|\.env)$/.test(name)) found.kept.push(rel);
    }
  }
  const generated = [...new Set(found.generated)].filter((rel) => !found.generated.some((other) => other !== rel && rel.startsWith(`${other}/`)));

  const moves = [];
  for (const rel of [...owned.OWNED_FILES, ...owned.GENERATED_FILES, ...found.generatedFiles].sort()) {
    const st = lstatOrNull(path.join(claudeDir, ...rel.split('/')));
    if (!st) continue;
    moves.push({ rel, type: st.isSymbolicLink() ? 'symlink' : 'file', bytes: st.size });
  }
  for (const rel of generated.sort()) {
    const bytes = sizeOf(path.join(claudeDir, ...rel.split('/')), { left: SIZE_WALK_CAP });
    moves.push({ rel, type: 'dir', bytes, generated: true });
  }
  const leftInPlace = lstatOrNull(path.join(claudeDir, ...owned.SHARED_VENV_PATH.split('/')))
    ? [`${owned.SHARED_VENV_PATH} (shared venv: other kits and your skills may use it; delete it by hand if unused)`] : [];

  // Without a Rig 1.x marker the Rig-looking names are somebody else's files (other kits ship the same agent/hook names)
  const detected = identified && (moves.length > 0 || settings.length > 0);
  if (identified) {
    const moveRels = { files: new Set(moves.map((m) => m.rel)), dirs: moves.filter((m) => m.type === 'dir').map((m) => m.rel) };
    blockers.push(...dangling(target, claudeDir, moveRels, stripped, mcpSources(kind, targetRoot)));
  }
  const plan = {
    kind, root: targetRoot, claudeDir, detected, identified, settings, moves, kept: found.kept.sort(), leftInPlace, blockers,
    unmarkedMatches: identified ? 0 : moves.length + settings.length,
    bytes: moves.reduce((sum, m) => sum + m.bytes, 0),
    backupGroup: backupGroupDir(home, kind, targetRoot),
    pendingBackup: findIncompleteBackup({ home, kind, root: targetRoot }),
  };
  plan.warnings = detected ? keptFileWarnings(plan) : [];
  if (!identified) { plan.settings = []; plan.moves = []; plan.bytes = 0; plan.blockers = []; plan.kept = []; plan.leftInPlace = []; plan.warnings = []; }
  if (kind === 'project' && detected) {
    const tracked = trackedClaudeFiles(targetRoot);
    const committedMoves = moves.filter((m) => tracked.has(m.rel)).length;
    const committedSettings = settings.some((s) => tracked.has(s.file));
    plan.committed = { files: committedMoves, settings: committedSettings };
    if (committedMoves || committedSettings) {
      plan.hint = `${committedMoves} of these files are committed in git. After the migration, commit the removal; teammates then need the Rig plugin ` +
        '(enable it in the project .claude/settings.json: extraKnownMarketplaces + enabledPlugins) or they lose the hooks and skills.';
    }
  }
  return plan;
}

/** The project root for a working dir: the dir itself when it has `.claude`, else the git top-level (run from `app/src`, `app/.claude` counts). */
function projectRootFor(dir) {
  if (lstatOrNull(path.join(dir, '.claude'))) return dir;
  try {
    const top = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return top ? fs.realpathSync(top) : dir;
  } catch {
    return dir;
  }
}

/** Targets to look at for `cwd`: the global install, and the project at cwd unless cwd is the home dir. */
function planAll({ home = os.homedir(), cwd = process.cwd() } = {}) {
  const targets = [];
  const global = planTarget({ kind: 'global', root: home, home });
  if (global) targets.push(global);
  let realCwd = cwd;
  let realHome = home;
  try { realCwd = fs.realpathSync(cwd); realHome = fs.realpathSync(home); } catch { /* use as given */ }
  realCwd = projectRootFor(realCwd);
  if (owned.norm(realCwd) !== owned.norm(realHome)) {
    const project = planTarget({ kind: 'project', root: realCwd, home });
    if (project) targets.push(project);
  }
  return targets;
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Moved paths grouped by top-level dir (skills by skill dir) with counts: what the confirmation prompt shows. */
function groupMoves(moves) {
  const groups = new Map();
  for (const m of moves) {
    const parts = m.rel.split('/');
    const key = parts.length === 1 ? '(top level files)' : parts[0] === 'skills' && parts.length > 2 ? `skills/${parts[1]}` : parts[0];
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/** Human summary of one target plan (the terminal prompt and `--plan` without --json). */
function describeTarget(plan) {
  const lines = [`${plan.kind === 'global' ? 'Global' : `Project ${plan.root}`} install: ${plan.claudeDir}`];
  // Shown first and regardless of detection: after a partial migration the install marker is already in the
  // backup, so the leftovers (e.g. a statusline held open on Windows) no longer look like a 1.x install.
  if (plan.pendingBackup) lines.push(`  an interrupted migration exists: ${plan.pendingBackup} (use --migrate --resume)`);
  if (!plan.identified && plan.pendingBackup) {
    lines.push('  the files still here belong to that migration; --resume moves them');
  } else if (!plan.identified && plan.unmarkedMatches > 0) {
    lines.push(`  found ${plan.unmarkedMatches} file(s) or settings entries with Rig 1.x names, but no Rig 1.x install marker (metadata.json named "rig", hooks/lib/rig-config-utils.cjs).`);
    lines.push('  They look like another kit\'s files (or your own), so rig-init leaves them alone.');
  } else if (!plan.detected) {
    lines.push('  no 1.x Rig files found');
  } else {
    const hooks = plan.settings.flatMap((s) => s.removeHooks.map((h) => `${s.file}: ${h.event}`));
    lines.push(`  settings: remove ${hooks.length} Rig hook registration(s)${plan.settings.some((s) => s.removeStatusLine) ? ' and the Rig statusLine' : ''} (your other settings stay)`);
    lines.push(`  move ${plan.moves.length} Rig path(s), ${formatBytes(plan.bytes)}, into ${path.join(plan.backupGroup, '<timestamp>')}${path.sep} (nothing is deleted, edits you made to Rig files are kept in the backup; restore.cjs there puts it all back)`);
    lines.push('  paths by directory:');
    for (const [dir, count] of groupMoves(plan.moves)) lines.push(`    ${dir}  ${count}`);
    lines.push('  the full list is written to <backup>/moved-paths.txt, and its path is printed.');
    if (plan.hint) lines.push(`  note: ${plan.hint}`);
  }
  if (plan.kept.length) lines.push(`  not Rig's, left in place (${plan.kept.length}): ${plan.kept.slice(0, 8).join(', ')}${plan.kept.length > 8 ? ', ...' : ''}`);
  for (const item of plan.leftInPlace || []) lines.push(`  left in place: ${item}`);
  for (const w of plan.warnings || []) lines.push(`  warning: ${w}`);
  for (const b of plan.blockers) lines.push(`  BLOCKED: ${b}`);
  return lines.join('\n');
}

module.exports = { planTarget, planAll, describeTarget, groupMoves, projectRootFor, projectHash, backupGroupDir, findIncompleteBackup, formatBytes, SETTINGS_FILES };
