/**
 * verify-guard-turn-counter.cjs - per-session nudge counter for the verify-completion-guard.
 *
 * The Stop hook must not rely on Claude Code's own continuation cap: it keeps its own count of how
 * many times it has nudged/blocked, in a small temp file `<tmpdir>/rig-verify-guard-<session_id>.json`
 * = {turnKey, count, chain, chainKey}.
 *   count  nudges in the current turn; a new turnKey resets it.
 *   chain  consecutive nudges issued while stop_hook_active was true, independent of the turn key
 *          (hard cap even if the key shifts per continuation); reset by any Stop where
 *          stop_hook_active is false, so a finished turn's chain never suppresses the next turn.
 * Writes are atomic: a fresh O_EXCL (`wx`, 0600) temp file with a random name, then rename, so a
 * symlink planted at a predictable name is never followed. incrementCount reports whether the write persisted: block mode
 * must allow the stop when it did not, or an unwritable tmpdir would block forever.
 * On the first write of a session, state files older than 24h are removed (bounded scan).
 *
 * Exports: readCount, readChain(sessionId), resetChain(sessionId), incrementCount(sessionId, turnKey, {active})
 *          -> {count, chain, persisted}, stateFile(sessionId), pruneStaleStateFiles(now)
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { stateDir } = require('./plugin-data-dir.cjs');

const PREFIX = 'rig-verify-guard-';
const STALE_MS = 24 * 60 * 60 * 1000;
const MAX_PRUNE_SCAN = 500;

/** Session ids become part of a file name: keep a safe charset, bounded length. */
function stateFile(sessionId) {
  const safe = String(sessionId || 'no-session').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  return path.join(stateDir(), `${PREFIX}${safe}.json`);
}

function readState(sessionId) {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(sessionId), 'utf8'));
    return s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
}

const positiveInt = (n) => (Number.isInteger(n) && n > 0 ? n : 0);

/** Nudges already issued in this turn (0 when the stored turn differs or nothing is stored). */
function readCount(sessionId, turnKey) {
  const s = readState(sessionId);
  return s.turnKey === turnKey ? positiveInt(s.count) : 0;
}

/**
 * Consecutive nudges issued while stop_hook_active was true. Deliberately NOT keyed to the turn key:
 * the key can shift on every continuation (window-exhausted turns), and a finished chain is ended by
 * resetChain() on the next non-active Stop instead.
 */
function readChain(sessionId) {
  return positiveInt(readState(sessionId).chain);
}

/** Atomic best-effort write of the state object; returns whether it persisted. */
function writeState(sessionId, state) {
  const file = stateFile(sessionId);
  const tmp = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    if (!fs.existsSync(file)) pruneStaleStateFiles();
    const fd = fs.openSync(tmp, 'wx', 0o600); // O_EXCL: never follows or reuses an existing path
    try {
      fs.writeSync(fd, JSON.stringify(state));
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
    return true;
  } catch {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    return false;
  }
}

/** Ends a chain: call on every Stop where stop_hook_active is false. No-op when no chain is stored. */
function resetChain(sessionId) {
  const s = readState(sessionId);
  if (positiveInt(s.chain) === 0) return;
  writeState(sessionId, { turnKey: s.turnKey, count: positiveInt(s.count), chain: 0, chainKey: s.chainKey });
}

/** Removes `rig-verify-guard-*` files in tmpdir not modified for 24h. Best effort, bounded. */
function pruneStaleStateFiles(now = Date.now()) {
  try {
    const dir = stateDir();
    // Filter first, then cap: a busy tmp or data dir must not hide our files from the scan.
    for (const name of fs.readdirSync(dir).filter((n) => n.startsWith(PREFIX)).slice(0, MAX_PRUNE_SCAN)) {
      const file = path.join(dir, name);
      try {
        if (now - fs.statSync(file).mtimeMs > STALE_MS) fs.rmSync(file, { force: true });
      } catch {
        // raced with another process: ignore
      }
    }
  } catch {
    // tmpdir unreadable: nothing to prune
  }
}

/**
 * Records one more nudge for this turn.
 * @param {{active?: boolean}} [opts] active: the Stop input had stop_hook_active === true
 * @returns {{count: number, chain: number, persisted: boolean}}
 */
function incrementCount(sessionId, turnKey, opts = {}) {
  const count = readCount(sessionId, turnKey) + 1;
  const chain = opts.active === true ? readChain(sessionId) + 1 : 1;
  const persisted = writeState(sessionId, { turnKey, count, chain, chainKey: turnKey });
  return { count, chain, persisted };
}

module.exports = { readCount, readChain, resetChain, incrementCount, stateFile, pruneStaleStateFiles };
