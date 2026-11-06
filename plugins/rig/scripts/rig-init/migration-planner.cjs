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

/**
 * Walk a directory below `.claude`: owned files become moves (already known by the list), generated dirs become dir
 * moves, anything else is "kept". `rel` is the posix path below `.claude`.
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
      if (owned.GENERATED_DIR_NAMES.has(name) || owned.GENERATED_DIR_PATHS.includes(childRel)) out.generated.push(childRel);
      else walk(claudeDir, childRel, out);
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

/**
 * @param {{kind: 'global'|'project', root: string, home: string}} opts root = the project dir (project) or ignored (global)
 * @returns {object|null} null when there is no `.claude` dir
 */
function planTarget({ kind, root, home }) {
  const targetRoot = kind === 'global' ? home : root;
  const claudeDir = path.join(targetRoot, '.claude');
  if (!lstatOrNull(claudeDir)) return null;
  const target = { kind, root: targetRoot };
  const blockers = [];

  const settings = [];
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
    const { removedHooks, removedStatusLine } = stripRigSettings(read.value, target);
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
  const detected = moves.length > 0 || settings.length > 0;
  const plan = {
    kind, root: targetRoot, claudeDir, detected, settings, moves, kept: found.kept.sort(), blockers,
    bytes: moves.reduce((sum, m) => sum + m.bytes, 0),
    backupGroup: backupGroupDir(home, kind, targetRoot),
    pendingBackup: findIncompleteBackup({ home, kind, root: targetRoot }),
  };
  if (kind === 'project') {
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

/** Targets to look at for `cwd`: the global install, and the project at cwd unless cwd is the home dir. */
function planAll({ home = os.homedir(), cwd = process.cwd() } = {}) {
  const targets = [];
  const global = planTarget({ kind: 'global', root: home, home });
  if (global) targets.push(global);
  let realCwd = cwd;
  let realHome = home;
  try { realCwd = fs.realpathSync(cwd); realHome = fs.realpathSync(home); } catch { /* use as given */ }
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

/** Human summary of one target plan (the terminal prompt and `--plan` without --json). */
function describeTarget(plan) {
  const lines = [`${plan.kind === 'global' ? 'Global' : `Project ${plan.root}`} install: ${plan.claudeDir}`];
  if (!plan.detected) return `${lines[0]}\n  no 1.x Rig files found`;
  const hooks = plan.settings.flatMap((s) => s.removeHooks.map((h) => `${s.file}: ${h.event}`));
  lines.push(`  settings: remove ${hooks.length} Rig hook registration(s)${plan.settings.some((s) => s.removeStatusLine) ? ' and the Rig statusLine' : ''} (your other settings stay)`);
  lines.push(`  move ${plan.moves.length} Rig path(s), ${formatBytes(plan.bytes)}, into ${plan.backupGroup}/<timestamp>/ (nothing is deleted, edits you made to Rig files are kept in the backup; restore.cjs there puts it all back)`);
  if (plan.kept.length) lines.push(`  not Rig's, left in place (${plan.kept.length}): ${plan.kept.slice(0, 8).join(', ')}${plan.kept.length > 8 ? ', ...' : ''}`);
  if (plan.hint) lines.push(`  note: ${plan.hint}`);
  if (plan.pendingBackup) lines.push(`  an interrupted migration exists: ${plan.pendingBackup} (use --migrate --resume)`);
  for (const b of plan.blockers) lines.push(`  BLOCKED: ${b}`);
  return lines.join('\n');
}

module.exports = { planTarget, planAll, describeTarget, projectHash, backupGroupDir, findIncompleteBackup, formatBytes, SETTINGS_FILES };
