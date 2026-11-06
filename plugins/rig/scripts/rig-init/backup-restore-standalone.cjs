'use strict';
/**
 * Dependency-free core of rig-init: filesystem primitives, the terminal consent gate and the restore of a migration
 * backup. Node built-ins only, because this file is also copied into every backup as `restore.cjs`, so a backup can
 * be restored with `node restore.cjs` after the plugin is gone (uninstalled, disabled, a new cache dir).
 *
 * Restore safety (red team: failure-modes #7, security #4):
 *   - only a backup rig-init created: the dir must sit inside `~/.claude/rig-backups/` (realpath), hold the marker
 *     file and a journal with the same id; anything else is refused;
 *   - every path comes from the journal and is checked: relative, no `..`, no drive/UNC form, and the real location of
 *     the destination's nearest existing ancestor must stay inside the recorded target (a planted symlink cannot
 *     redirect a write); the target itself must be `<home>/.claude` or `<recorded project>/.claude`;
 *   - the plugin must be disabled first (enabled plugin + restored 1.x hooks = every hook twice);
 *   - files are restored before settings, and settings are merged 3-way (the journal records what Rig removed;
 *     everything else in the CURRENT settings, including changes made after the migration, is kept);
 *   - an existing file at a destination is never overwritten (reported as a conflict, kept in the backup).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const MARKER_FILE = 'rig-backup.json';
const JOURNAL_FILE = 'journal.json';
const FILES_DIR = 'files';
const SETTINGS_DIR = 'settings';
const RUNTIME_STATUSLINE_RE = /rig[/\\]runtime[/\\]statusline\.cjs/;
const RETRY_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY']);
const RETRIES = 5;

const IS_WIN = process.platform === 'win32';
const norm = (p) => { const s = path.resolve(p).replace(/\\/g, '/'); return IS_WIN ? s.toLowerCase() : s; };
const isInside = (parent, child) => norm(child).startsWith(`${norm(parent)}/`);

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Retry a Windows-style transient failure (file in use) with a growing pause; the last error is thrown. */
function withRetry(fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return fn();
    } catch (err) {
      if (attempt >= RETRIES || !RETRY_CODES.has(err.code)) throw err;
      sleepSync(100 * (attempt + 1));
    }
  }
}

/** @returns {{exists: boolean, value: object|null}} throws a readable error for an unparsable file (never overwrite it) */
function readJsonFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { exists: false, value: null };
    throw err;
  }
  try {
    const value = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not a JSON object');
    return { exists: true, value };
  } catch (err) {
    throw new Error(`cannot parse ${file} (${err.message}); fix it first, rig-init never overwrites a file it cannot read`, { cause: err });
  }
}

/** Write JSON through a temp file in the same dir and a rename, so a reader never sees half a file; keeps the old mode. */
function writeJsonAtomic(file, value, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.rig-tmp-${process.pid}`;
  let fileMode = mode;
  if (fileMode === undefined) {
    try { fileMode = fs.statSync(file).mode & 0o777; } catch { fileMode = 0o644; }
  }
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: fileMode });
    withRetry(() => fs.renameSync(tmp, file));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Move a file, directory or symlink; copies across devices; an existing destination is replaced (the backup's partial copy). */
function movePath(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    withRetry(() => {
      fs.rmSync(dest, { recursive: true, force: true });
      fs.renameSync(src, dest);
    });
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    // Different filesystem (backups live under ~/.claude, a project may not): copy, then remove the source
    fs.cpSync(src, dest, { recursive: true, dereference: false, force: true, verbatimSymlinks: true });
    withRetry(() => fs.rmSync(src, { recursive: true, force: true }));
  }
}

/** A journal-supplied relative path as safe segments, or null: no absolute, drive, UNC, empty, `.` or `..` segments, NUL. */
function safeSegments(rel) {
  if (typeof rel !== 'string' || rel === '' || rel.includes('\0')) return null;
  if (/^[/\\]/.test(rel) || /^[A-Za-z]:/.test(rel)) return null;
  const segments = rel.split(/[/\\]/);
  return segments.every((s) => s !== '' && s !== '.' && s !== '..') ? segments : null;
}

/** Real path of the nearest existing ancestor of `p`, followed by the missing tail (so a not-yet-created file can be checked). */
function realpathOfDeepestExisting(p) {
  const tail = [];
  let current = path.resolve(p);
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...tail.reverse());
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') throw err;
      const parent = path.dirname(current);
      if (parent === current) throw err;
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

/** `<base>/<rel>` after the lexical and the real-path containment checks; throws when it could leave `base`. */
function containedPath(base, rel, label) {
  const segments = safeSegments(rel);
  if (!segments) throw new Error(`${label}: unsafe path in the backup journal: ${JSON.stringify(rel)}`);
  const full = path.join(base, ...segments);
  if (!isInside(realpathOfDeepestExisting(base), realpathOfDeepestExisting(path.dirname(full)) + path.sep + path.basename(full))) {
    throw new Error(`${label}: ${rel} resolves outside ${base}`);
  }
  return full;
}

// ---------- consent ----------

/**
 * Why an apply verb must not run here, or null. Applying changes user config, so it needs the user's own terminal:
 * inside a Claude Code session (CLAUDECODE is set in every tool process) a model could otherwise run it itself, and
 * without a TTY nobody can answer the prompt. There is no flag that skips this.
 */
function applyRefusal({ env = process.env, stdinIsTTY = Boolean(process.stdin.isTTY), stdoutIsTTY = Boolean(process.stdout.isTTY), command }) {
  if (env.CLAUDECODE) {
    return `rig-init changes your Claude Code configuration, so it only runs in a terminal outside Claude Code (CLAUDECODE is set here).\nRun this yourself in a terminal:\n\n  ${command}\n`;
  }
  if (!stdinIsTTY || !stdoutIsTTY) {
    return `rig-init needs an interactive terminal to ask for your confirmation (stdin/stdout is not a TTY), and has no option to skip it.\nRun this in a terminal:\n\n  ${command}\n`;
  }
  return null;
}

/** y/N prompt on the terminal; only an explicit y/yes accepts. */
function askYesNo(question, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, output });
    rl.question(`${question} [y/N] `, (answer) => { rl.close(); resolve(/^y(es)?$/i.test(answer.trim())); });
    rl.on('close', () => resolve(false));
  });
}

// ---------- restore ----------

const backupsDirFor = (home) => path.join(home, '.claude', 'rig-backups');

/** Plugin entries named `rig@...` that are enabled in user, project or local settings. */
function enabledRigPlugins({ home, root }) {
  const files = [path.join(home, '.claude', 'settings.json')];
  if (root) files.push(path.join(root, '.claude', 'settings.json'), path.join(root, '.claude', 'settings.local.json'));
  const found = [];
  for (const file of files) {
    let settings;
    try { settings = readJsonFile(file).value; } catch { continue; }
    for (const [name, on] of Object.entries((settings && settings.enabledPlugins) || {})) {
      if (/^rig@/.test(name) && on === true) found.push({ name, file });
    }
  }
  return found;
}

/** Validates the backup dir and returns its journal; throws on anything that is not a rig-init backup of this home. */
function loadBackup(backupDir, home) {
  const real = fs.realpathSync(backupDir);
  const backupsReal = fs.realpathSync(backupsDirFor(home));
  if (!isInside(backupsReal, real)) throw new Error(`refusing ${backupDir}: it is not inside ${backupsDirFor(home)}, so rig-init did not create it`);
  const marker = readJsonFile(path.join(real, MARKER_FILE)).value;
  if (!marker || marker.createdBy !== 'rig-init' || marker.schema !== 1) throw new Error(`refusing ${backupDir}: no valid ${MARKER_FILE} marker`);
  const journal = readJsonFile(path.join(real, JOURNAL_FILE)).value;
  if (!journal || journal.id !== marker.id || journal.schema !== 1) throw new Error(`refusing ${backupDir}: the journal does not belong to this backup`);
  const claudeDir = path.resolve(marker.claudeDir);
  const expected = marker.kind === 'global' ? path.join(path.resolve(home), '.claude') : path.join(path.resolve(String(marker.root)), '.claude');
  if ((marker.kind !== 'global' && marker.kind !== 'project') || norm(claudeDir) !== norm(expected)) {
    throw new Error(`refusing ${backupDir}: recorded target ${marker.claudeDir} is not ${expected}`);
  }
  return { real, marker, journal, claudeDir };
}

/** Put the removed Rig hook handlers and statusLine back into the CURRENT settings; everything else stays as it is now. */
function mergeRigSettingsBack(current, saved, claudeDir, report) {
  const merged = structuredClone(current);
  for (const item of saved.removedHooks || []) {
    if (!fs.existsSync(path.join(claudeDir, ...item.rel.split('/')))) { report.skippedHooks.push(item.handler.command); continue; }
    merged.hooks = merged.hooks && typeof merged.hooks === 'object' ? merged.hooks : {};
    const entries = Array.isArray(merged.hooks[item.event]) ? merged.hooks[item.event] : (merged.hooks[item.event] = []);
    if (entries.some((e) => e && Array.isArray(e.hooks) && e.hooks.some((h) => h && h.command === item.handler.command))) continue;
    const sameEntry = entries.find((e) => e && Array.isArray(e.hooks) && e.matcher === item.entry.matcher);
    if (sameEntry) sameEntry.hooks.push(item.handler);
    else entries.push({ ...item.entry, hooks: [item.handler] });
    report.hooksRestored++;
  }
  if (saved.removedStatusLine) {
    const now = merged.statusLine;
    // Ours to replace: nothing there, or the plugin's own runtime statusline; anything else is the user's choice since then
    if (!now || (typeof now.command === 'string' && RUNTIME_STATUSLINE_RE.test(now.command))) {
      merged.statusLine = saved.removedStatusLine;
      report.statusLineRestored = true;
    } else {
      report.statusLineKept = true;
    }
  }
  return merged;
}

/**
 * Restore a migration backup into the target recorded in it.
 * @param {{backupDir: string, home?: string}} opts
 * @returns {{moved: number, conflicts: string[], hooksRestored: number, skippedHooks: string[], statusLineRestored: boolean, statusLineKept: boolean}}
 */
function restoreBackup({ backupDir, home = os.homedir() }) {
  const { real, marker, journal, claudeDir } = loadBackup(backupDir, home);
  const enabled = enabledRigPlugins({ home, root: marker.kind === 'project' ? marker.root : null });
  if (enabled.length) {
    const where = enabled.map((e) => `${e.name} (${e.file})`).join(', ');
    throw new Error(`the Rig plugin is still enabled: ${where}. Restoring the 1.x hooks next to it runs every hook twice.\nDisable it first: run \`claude plugin disable rig@rig-marketplace\` (add \`--scope project\` for a project install) or use /plugin, then run this again.`);
  }
  const report = { moved: 0, conflicts: [], hooksRestored: 0, skippedHooks: [], statusLineRestored: false, statusLineKept: false };
  fs.mkdirSync(claudeDir, { recursive: true });
  // Files first: while they are being put back no settings entry points at them yet
  for (const move of journal.moves || []) {
    const dest = containedPath(claudeDir, move.rel, 'restore target');
    const src = containedPath(path.join(real, FILES_DIR), move.rel, 'backup file');
    let present = true;
    try { fs.lstatSync(src); } catch { present = false; }
    if (!present) continue; // never moved (busy or already restored)
    let occupied = true;
    try { fs.lstatSync(dest); } catch { occupied = false; }
    if (occupied) { report.conflicts.push(move.rel); continue; } // never overwrite what is there now
    movePath(src, dest);
    report.moved++;
  }
  for (const saved of journal.settings || []) {
    if (!(saved.removedHooks || []).length && !saved.removedStatusLine) continue;
    const file = containedPath(claudeDir, saved.file, 'settings file');
    const current = readJsonFile(file).value || {};
    writeJsonAtomic(file, mergeRigSettingsBack(current, saved, claudeDir, report));
  }
  const log = { restoredAt: new Date().toISOString(), ...report };
  writeJsonAtomic(path.join(real, 'restored.json'), log, 0o600);
  return report;
}

function describeRestore(report) {
  const lines = [`Restored ${report.moved} path(s), ${report.hooksRestored} hook registration(s).`];
  if (report.statusLineRestored) lines.push('Restored the 1.x statusLine.');
  if (report.statusLineKept) lines.push('Kept your current statusLine (changed after the migration).');
  if (report.conflicts.length) lines.push(`Left in the backup, because a file exists there now: ${report.conflicts.join(', ')}`);
  if (report.skippedHooks.length) lines.push(`Not re-registered, the hook file is missing: ${report.skippedHooks.join(', ')}`);
  return lines.join('\n');
}

/** Entry of the copy that lives in a backup: `node restore.cjs` restores this backup, after a terminal confirmation. */
async function standaloneMain() {
  const backupDir = __dirname;
  const refusal = applyRefusal({ command: `node ${path.join(backupDir, 'restore.cjs')}` });
  if (refusal) { process.stderr.write(refusal); process.exit(2); }
  try {
    const ok = await askYesNo(`Restore the Rig 1.x files and hooks from ${backupDir}?`);
    if (!ok) { console.log('Cancelled.'); return; }
    console.log(describeRestore(restoreBackup({ backupDir })));
  } catch (err) {
    process.stderr.write(`restore failed: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module && path.basename(__filename) === 'restore.cjs') standaloneMain();

module.exports = {
  withRetry, MARKER_FILE, JOURNAL_FILE, FILES_DIR, SETTINGS_DIR, readJsonFile, writeJsonAtomic, movePath, safeSegments, containedPath,
  isInside, norm, applyRefusal, askYesNo, restoreBackup, describeRestore, backupsDirFor, enabledRigPlugins, realpathOfDeepestExisting,
};
