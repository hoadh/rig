'use strict';
/**
 * Applies a migration plan with a journal, so an interruption at any point leaves a consistent machine and
 * `--resume` finishes the job (red team: failure-modes #2, #10; security #4).
 *
 * Order (each step is saved to `journal.json` through a temp file + rename):
 *   1. backup dir (outside every repo, 0700) with marker file, `restore.cjs`, and the journal listing what will change
 *      (including the exact settings entries that will be removed);
 *   2. copy each settings file into the backup;
 *   3. rewrite each settings file atomically WITHOUT the Rig entries (user keys kept);
 *   4. move the owned paths into the backup (`files/<rel>`); a path in use (Windows: EBUSY/EPERM on an open
 *      statusline) is retried, then left in place and listed as `blocked`;
 *   5. mark the journal `done` (or leave it open when something is blocked).
 * Settings are rewritten BEFORE any file moves: if the machine stops at any point, settings never point at a hook
 * file that is gone (a missing hook would fail every event with MODULE_NOT_FOUND). Every step is idempotent, so resume
 * simply runs the steps again.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  MARKER_FILE, JOURNAL_FILE, FILES_DIR, SETTINGS_DIR, readJsonFile, writeJsonAtomic, movePath, containedPath, isInside, norm,
  backupsDirFor,
} = require('./backup-restore-standalone.cjs');
const { stripRigSettings } = require('./settings-rig-entries-stripper.cjs');
const { backupGroupDir, planTarget, findIncompleteBackup } = require('./migration-planner.cjs');
const { acquireLock, releaseLock } = require('../../hooks/lib/dir-lock-with-owner-token.cjs');

const STANDALONE_SOURCE = path.join(__dirname, 'backup-restore-standalone.cjs');
const LOCK_STALE_MS = 10 * 60 * 1000;
const MOVED_LIST_FILE = 'moved-paths.txt';

function timestamp(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${String(date.getFullYear()).slice(2)}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

function privateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* Windows: ACLs of the profile dir apply */ }
}

/** Creates `<group>/<ts>[-n]` exclusively (two runs in one second never share a dir). */
function createBackupDir(group, now) {
  privateDir(group);
  const base = path.join(group, timestamp(now));
  for (let n = 0; ; n++) {
    const dir = n === 0 ? base : `${base}-${n}`;
    try {
      fs.mkdirSync(dir, { mode: 0o700 });
      try { fs.chmodSync(dir, 0o700); } catch { /* see privateDir */ }
      return dir;
    } catch (err) {
      if (err.code !== 'EEXIST' || n > 50) throw err;
    }
  }
}

/** Refresh the lock dir's mtime: the stale-lock takeover judges by age, and a slow copy must not look dead. */
function heartbeat(lockDir) {
  if (!lockDir) return;
  try { const now = new Date(); fs.utimesSync(lockDir, now, now); } catch { /* lock gone: the owner-token check on release handles it */ }
}

/** Atomic journal save (readers and a crash never see half a journal). */
function saveJournal(backupDir, journal) {
  writeJsonAtomic(path.join(backupDir, JOURNAL_FILE), journal, 0o600);
}

function pruneEmptyDirs(claudeDir, rels) {
  const dirs = new Set();
  for (const rel of rels) {
    for (let dir = path.dirname(path.join(claudeDir, ...rel.split('/'))); isInside(claudeDir, dir); dir = path.dirname(dir)) dirs.add(dir);
  }
  for (const dir of [...dirs].sort((a, b) => b.length - a.length)) {
    try { if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir); } catch { /* not empty, gone, or in use */ }
  }
}

/**
 * Runs the remaining steps of a journal. `hooks.afterStep(name)` is called after every step has been made durable
 * (tests throw from it to simulate a crash at that exact point).
 */
function runJournal({ backupDir, journal, hooks = {}, lockDir = null }) {
  const step = (name) => { if (hooks.afterStep) hooks.afterStep(name); };
  const claudeDir = journal.claudeDir;
  const target = { kind: journal.kind, root: journal.root };

  // 2. settings backups
  for (const entry of journal.settings) {
    if (entry.backedUp) continue;
    if (entry.existed) {
      const dest = path.join(backupDir, SETTINGS_DIR, entry.file);
      fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
      fs.copyFileSync(containedPath(claudeDir, entry.file, 'settings file'), dest);
    }
    entry.backedUp = true;
    saveJournal(backupDir, journal);
    step(`backup-settings:${entry.file}`);
  }

  // 3. settings without the Rig entries, atomically; skipped when already written
  for (const entry of journal.settings) {
    if (entry.written) continue;
    if (entry.existed && (entry.removedHooks.length || entry.removedStatusLine)) {
      const file = containedPath(claudeDir, entry.file, 'settings file');
      const current = readJsonFile(file).value;
      if (current) {
        const { settings } = stripRigSettings(current, target);
        writeJsonAtomic(file, settings);
      }
    }
    entry.written = true;
    saveJournal(backupDir, journal);
    step(`write-settings:${entry.file}`);
  }

  // 4. moves; sorted order, filesystem state decides what is left (a moved path no longer exists at its source).
  // Any failure of one move (file in use, a path that resolves outside the target) leaves THAT path pending, never aborts the run.
  const blocked = [];
  let moved = 0;
  const filesDir = path.join(backupDir, FILES_DIR);
  for (const move of journal.moves) {
    heartbeat(lockDir); // a long run must not look like a stale lock
    try {
      const src = containedPath(claudeDir, move.rel, 'migration source');
      const dest = containedPath(filesDir, move.rel, 'backup destination');
      let exists = true;
      try { fs.lstatSync(src); } catch { exists = false; }
      if (exists) {
        // `copied` is set once a cross-device copy is complete: from then on resume only finishes removing the source
        (hooks.movePath || movePath)(src, dest, { copyDone: move.copied === true, onCopied: () => { move.copied = true; saveJournal(backupDir, journal); } });
        moved++;
      }
    } catch (err) {
      blocked.push({ rel: move.rel, code: err.code || 'ERROR', message: err.message });
    }
    step(`move:${move.rel}`);
  }
  pruneEmptyDirs(claudeDir, journal.moves.map((m) => m.rel));

  // 5. finish
  journal.blocked = blocked;
  journal.status = blocked.length ? 'in-progress' : 'done';
  journal.finishedAt = blocked.length ? null : new Date().toISOString();
  saveJournal(backupDir, journal);
  step('finish');
  return { backupDir, status: journal.status, blocked, moved, settingsChanged: journal.settings.filter((s) => s.removedHooks.length || s.removedStatusLine).length };
}

/** Runs `fn` while holding the per-target lock; refuses a second concurrent migration of the same target. */
function withTargetLock(group, fn) {
  privateDir(group);
  const lockDir = `${group}.lock`;
  const token = acquireLock(lockDir, LOCK_STALE_MS);
  if (!token) throw new Error(`another rig-init is migrating this target (lock ${lockDir}); wait for it, or remove the lock dir if no rig-init is running`);
  try {
    return fn(lockDir);
  } finally {
    releaseLock(lockDir, token);
  }
}

/**
 * Start a migration of one planned target.
 * @param {{plan: object, home: string, rigVersion: string, now?: Date, hooks?: {afterStep?: Function}}} opts
 */
/**
 * A fresh plan for the target, or an error: an interrupted migration, no Rig 1.x marker, or a blocker (symlinked dir,
 * unparsable settings, a settings entry that still runs a moved file) all refuse. The plan handed in was made before the
 * confirmation prompt (and maybe before another run crashed), so only the plan made now says what is true.
 */
function freshPlanOrThrow({ kind, root, home }) {
  const pending = findIncompleteBackup({ home, kind, root });
  if (pending) throw new Error(`an earlier migration was interrupted (${pending}); run rig-init --migrate --resume`);
  const plan = planTarget({ kind, root, home });
  if (!plan || !plan.detected) throw new Error('nothing to migrate (no Rig 1.x install marker, or the install changed since the plan was made)');
  if (plan.blockers.length) throw new Error(`cannot migrate: ${plan.blockers.join('; ')}`);
  return plan;
}

function applyMigration({ plan: staleCopy, home, rigVersion, now = new Date(), hooks = {} }) {
  const group = backupGroupDir(home, staleCopy.kind, staleCopy.root);
  freshPlanOrThrow({ kind: staleCopy.kind, root: staleCopy.root, home }); // before any directory is created
  return withTargetLock(group, (lockDir) => {
    const plan = freshPlanOrThrow({ kind: staleCopy.kind, root: staleCopy.root, home }); // again under the lock
    privateDir(backupsDirFor(home));
    const backupDir = createBackupDir(group, now);
    const target = { kind: plan.kind, root: plan.root };
    const id = crypto.randomBytes(8).toString('hex');
    const claudeDir = fs.realpathSync(plan.claudeDir);
    // Settings removals are decided now, from the very bytes that get backed up, and recorded before anything changes
    const settings = plan.settings.map((s) => {
      const current = readJsonFile(path.join(claudeDir, s.file)).value;
      const { removedHooks, removedStatusLine } = stripRigSettings(current, target);
      return { file: s.file, existed: true, removedHooks, removedStatusLine, backedUp: false, written: false };
    });
    const marker = { schema: 1, createdBy: 'rig-init', id, kind: plan.kind, root: plan.root, claudeDir, rigVersion, createdAt: now.toISOString() };
    writeJsonAtomic(path.join(backupDir, MARKER_FILE), marker, 0o600);
    fs.copyFileSync(STANDALONE_SOURCE, path.join(backupDir, 'restore.cjs'));
    fs.writeFileSync(path.join(backupDir, 'README.txt'), `Rig 1.x files moved out of ${claudeDir} by rig-init.\nTo put them back: disable the Rig plugin, then run in a terminal:\n  node ${path.join(backupDir, 'restore.cjs')}\n`);
    fs.writeFileSync(path.join(backupDir, MOVED_LIST_FILE), `${plan.moves.map((m) => m.rel).join('\n')}\n`);
    const journal = {
      schema: 1, id, status: 'in-progress', kind: plan.kind, root: plan.root, claudeDir, rigVersion, startedAt: now.toISOString(),
      settings, moves: plan.moves.map((m) => ({ rel: m.rel, type: m.type })), blocked: [], finishedAt: null,
    };
    saveJournal(backupDir, journal);
    if (hooks.afterStep) hooks.afterStep('journal');
    return { ...runJournal({ backupDir, journal, hooks, lockDir }), listFile: path.join(backupDir, MOVED_LIST_FILE) };
  });
}

/** Finish an interrupted migration from its backup dir. */
function resumeMigration({ backupDir, home, hooks = {} }) {
  const real = fs.realpathSync(backupDir);
  if (!isInside(fs.realpathSync(backupsDirFor(home)), real)) throw new Error(`refusing ${backupDir}: not inside ${backupsDirFor(home)}`);
  const marker = readJsonFile(path.join(real, MARKER_FILE)).value;
  const journal = readJsonFile(path.join(real, JOURNAL_FILE)).value;
  if (!marker || marker.createdBy !== 'rig-init' || !journal || journal.id !== marker.id) throw new Error(`refusing ${backupDir}: not a rig-init backup`);
  const expected = marker.kind === 'global' ? path.join(path.resolve(home), '.claude') : path.join(path.resolve(String(marker.root)), '.claude');
  if (norm(journal.claudeDir) !== norm(expected) && norm(journal.claudeDir) !== norm(fs.realpathSync(expected))) throw new Error(`refusing ${backupDir}: recorded target does not match`);
  if (journal.status === 'done') return { backupDir: real, status: 'done', blocked: [], moved: 0, settingsChanged: 0 };
  return withTargetLock(path.dirname(real), (lockDir) => runJournal({ backupDir: real, journal, hooks, lockDir }));
}

module.exports = { applyMigration, resumeMigration, runJournal, timestamp, createBackupDir, privateDir };
