'use strict';
/**
 * Settings file I/O for rig-init: read a JSON object (refusing a file it cannot parse), write it atomically (a
 * symlinked settings.json stays a symlink), and create private, timestamped backup dirs under ~/.claude/rig-backups.
 */
const fs = require('fs');
const path = require('path');

const RETRY_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY']);
const RETRIES = 5;

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

const backupsDirFor = (home) => path.join(home, '.claude', 'rig-backups');

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

module.exports = { readJsonFile, writeJsonAtomic, withRetry, backupsDirFor, privateDir, createBackupDir };
