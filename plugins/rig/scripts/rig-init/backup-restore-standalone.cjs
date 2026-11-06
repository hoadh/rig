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
const { spawnSync } = require('child_process');

const MARKER_FILE = 'rig-backup.json';
const JOURNAL_FILE = 'journal.json';
const FILES_DIR = 'files';
const SETTINGS_DIR = 'settings';
const RUNTIME_STATUSLINE_RE = /rig[/\\]runtime[/\\]statusline\.cjs/;
const RETRY_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY']);
const RETRIES = 5;

// Case-insensitive file systems (Windows, macOS default): compare paths case-folded
const FOLD_CASE = process.platform === 'win32' || process.platform === 'darwin';
const norm = (p) => { const s = path.resolve(p).replace(/\\/g, '/'); return FOLD_CASE ? s.toLowerCase() : s; };
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

/**
 * Write JSON through a temp file next to the REAL target and a rename, so a reader never sees half a file, the old mode
 * is kept, and a symlinked settings.json (dotfiles managers) stays a symlink: the link's target is replaced, not the link.
 */
function writeJsonAtomic(file, value, mode) {
  let target = file;
  try { target = fs.realpathSync(file); } catch { /* not there yet: create it in place */ }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.rig-tmp-${process.pid}`;
  let fileMode = mode;
  if (fileMode === undefined) {
    try { fileMode = fs.statSync(target).mode & 0o777; } catch { fileMode = 0o644; }
  }
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: fileMode });
    withRetry(() => fs.renameSync(tmp, target));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };

/** Moves an existing destination out of the way (never deleted: it may be the only complete copy). */
function setAside(dest) {
  for (let n = 0; ; n++) {
    const aside = `${dest}.prev${n ? `-${n}` : ''}`;
    if (!exists(aside)) { fs.renameSync(dest, aside); return; }
  }
}

/**
 * Move a file, directory or symlink without ever deleting the only complete copy.
 *  - same device: one rename;
 *  - another device (EXDEV): copy to `<dest>.partial`, rename it into place, call `onCopied()` (the caller records
 *    "copy complete" in its journal), and only then remove the source. A source that cannot be removed completely
 *    (file in use) stays partial while the backup copy is whole.
 *  - `copyDone` (the journal says the copy completed): the destination is whole, so only the source is removed.
 * A destination that already exists is set aside as `<dest>.prev`, never removed.
 * @param {string} src
 * @param {string} dest
 * @param {{copyDone?: boolean, onCopied?: () => void}} [opts]
 */
function movePath(src, dest, { copyDone = false, onCopied } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (copyDone) {
    withRetry(() => fs.rmSync(src, { recursive: true, force: true }));
    return;
  }
  try {
    withRetry(() => {
      if (exists(dest) && fs.lstatSync(dest).isDirectory()) setAside(dest); // a rename onto a non-empty dir would fail
      fs.renameSync(src, dest);
    });
    return;
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
  }
  const partial = `${dest}.partial`;
  fs.rmSync(partial, { recursive: true, force: true }); // only ever a half-written copy: safe to drop
  fs.cpSync(src, partial, { recursive: true, dereference: false, force: true, verbatimSymlinks: true });
  if (exists(dest)) setAside(dest);
  fs.renameSync(partial, dest);
  if (onCopied) onCopied();
  withRetry(() => fs.rmSync(src, { recursive: true, force: true }));
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

const MAX_ANCESTRY_DEPTH = 40;
const baseName = (p) => path.basename(String(p || '').replace(/\\/g, '/')).toLowerCase().replace(/\.exe$/, '');

/** True when a process looks like Claude Code: the `claude` binary, or node/bun running the claude CLI package. */
function isClaudeCodeProcess({ name = '', args = [] }) {
  if (baseName(name) === 'claude' || baseName(args[0]) === 'claude') return true;
  const interpreter = ['node', 'nodejs', 'bun', 'deno'].includes(baseName(args[0])) || ['node', 'nodejs', 'bun', 'deno'].includes(baseName(name));
  const script = args.slice(1).find((a) => !a.startsWith('-')) || '';
  return interpreter && (/[/\\]claude-code[/\\]/.test(script) || baseName(script) === 'claude');
}

/**
 * The chain of ancestor processes of this one, nearest first: Linux /proc, macOS `ps`, Windows one PowerShell/CIM
 * query (5 s timeout). Throws when the chain cannot be read, so the caller fails closed.
 */
function readAncestry({ platform = process.platform, startPid = process.pid, run = spawnSync, readFile = fs.readFileSync } = {}) {
  const chain = [];
  if (platform === 'linux') {
    let pid = startPid;
    for (let i = 0; i < MAX_ANCESTRY_DEPTH; i++) {
      const stat = readFile(`/proc/${pid}/stat`, 'utf8');
      const m = /^\d+ \((.*)\) \S (\d+)/s.exec(stat);
      if (!m) throw new Error(`cannot parse /proc/${pid}/stat`);
      const ppid = Number(m[2]);
      if (pid !== startPid) {
        let args = [];
        try { args = readFile(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean); } catch { /* exited or hidden: name alone */ }
        chain.push({ pid, name: m[1], args });
      }
      if (ppid <= 1) break;
      pid = ppid;
    }
    return chain;
  }
  if (platform === 'win32') {
    const res = run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    if (res.error || res.status !== 0) throw new Error(`process query failed: ${res.error ? res.error.message : `exit ${res.status}`}`);
    const rows = [].concat(JSON.parse(res.stdout));
    const byPid = new Map(rows.map((r) => [r.ProcessId, r]));
    let pid = byPid.get(startPid) && byPid.get(startPid).ParentProcessId;
    for (let i = 0; i < MAX_ANCESTRY_DEPTH && byPid.has(pid); i++) {
      const row = byPid.get(pid);
      chain.push({ pid, name: row.Name, args: String(row.CommandLine || '').split(/\s+/).filter(Boolean) });
      pid = row.ParentProcessId;
    }
    return chain;
  }
  // macOS and other POSIX
  let pid = startPid;
  for (let i = 0; i < MAX_ANCESTRY_DEPTH; i++) {
    const res = run('ps', ['-o', 'ppid=,comm=,args=', '-p', String(pid)], { encoding: 'utf8', timeout: 5000 });
    const m = !res.error && res.status === 0 ? /^\s*(\d+)\s+(\S+)\s*(.*)$/.exec(String(res.stdout).split('\n')[0] || '') : null;
    if (!m) throw new Error(`ps could not describe pid ${pid}`);
    const ppid = Number(m[1]);
    if (pid !== startPid) chain.push({ pid, name: m[2], args: m[3].split(/\s+/).filter(Boolean) });
    if (ppid <= 1) break;
    pid = ppid;
  }
  return chain;
}

/**
 * Why an apply verb must not run here, or null. Applying changes user config, so it needs the user's own terminal:
 *  - CLAUDECODE set, or ANY ancestor process is Claude Code (`env -u CLAUDECODE` cannot hide the ancestry; a pty made
 *    with `script` still has Claude Code as an ancestor): refused;
 *  - the ancestry cannot be read: refused (fail closed);
 *  - no TTY: nobody can answer the prompt: refused.
 * There is no flag that skips this. `ancestors` is a test seam: a chain, or a function returning one (the real chain is read when it is not given); consent against
 * a determined agent is defense in depth, not a guarantee.
 */
function applyRefusal({ env = process.env, stdinIsTTY = Boolean(process.stdin.isTTY), stdoutIsTTY = Boolean(process.stdout.isTTY), command, ancestors }) {
  const outside = `Run this yourself in a terminal:\n\n  ${command}\n`;
  if (env.CLAUDECODE) {
    return `rig-init changes your Claude Code configuration, so it only runs in a terminal outside Claude Code (CLAUDECODE is set here).\n${outside}`;
  }
  let chain;
  {
    try {
      chain = typeof ancestors === 'function' ? ancestors() : ancestors || readAncestry();
    } catch (err) {
      return `rig-init could not check whether it was started from inside Claude Code (${err.message}), so it refuses.\n${outside}`;
    }
  }
  const claude = chain.find(isClaudeCodeProcess);
  if (claude) return `rig-init changes your Claude Code configuration, so it only runs in a terminal outside Claude Code (a parent process, pid ${claude.pid}, is Claude Code).\n${outside}`;
  if (!stdinIsTTY || !stdoutIsTTY) {
    return `rig-init needs an interactive terminal to ask for your confirmation (stdin/stdout is not a TTY), and has no option to skip it.\n${outside}`;
  }
  return null;
}

/** y/N prompt on the terminal; only an explicit y/yes accepts. */
function askYesNo(question, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, output });
    // Resolve BEFORE closing: rl.close() emits 'close' synchronously, and the close handler (EOF = no) must not win
    rl.question(`${question} [y/N] `, (answer) => { resolve(/^y(es)?$/i.test(answer.trim())); rl.close(); });
    rl.on('close', () => resolve(false)); // EOF without an answer; a no-op when the answer already resolved
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
    // An unparsable file must not count as "plugin not enabled": fail before anything is moved
    settings = readJsonFile(file).value;
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
function mergeRigSettingsBack(current, saved, claudeDir, report, conflicts) {
  const merged = structuredClone(current);
  for (const item of saved.removedHooks || []) {
    // Skip a hook whose file is gone, or whose path now holds a DIFFERENT file the user put there (a conflict): it is not Rig's hook any more
    if (conflicts.has(item.rel) || !fs.existsSync(path.join(claudeDir, ...item.rel.split('/')))) { report.skippedHooks.push(item.handler.command); continue; }
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
  if (marker.kind === 'project' && !fs.existsSync(marker.root)) throw new Error(`the project ${marker.root} no longer exists; restoring would recreate it. Recreate or move it back first`);
  // Every settings file must be readable BEFORE any file moves, so a bad one cannot leave a half restore
  for (const saved of journal.settings || []) {
    if ((saved.removedHooks || []).length || saved.removedStatusLine) readJsonFile(containedPath(claudeDir, saved.file, 'settings file'));
  }
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
    writeJsonAtomic(file, mergeRigSettingsBack(current, saved, claudeDir, report, new Set(report.conflicts)));
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
  isInside, norm, applyRefusal, readAncestry, isClaudeCodeProcess, askYesNo, restoreBackup, describeRestore, backupsDirFor, enabledRigPlugins, realpathOfDeepestExisting,
};
