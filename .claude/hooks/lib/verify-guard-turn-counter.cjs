/**
 * verify-guard-turn-counter.cjs - per-session nudge counter for the verify-completion-guard.
 *
 * The Stop hook must not rely on Claude Code's own continuation cap: it keeps its own count of how
 * many times it has nudged/blocked, in a small temp file `<tmpdir>/rig-verify-guard-<session_id>.json`
 * = {turnKey, count, chain}.
 *   count  nudges in the current turn; a new turnKey resets it.
 *   chain  consecutive nudges that were issued while stop_hook_active was true, independent of
 *          turnKey (hard cap against a turnKey that changes on every continuation).
 * Writes are atomic (tmp + rename). incrementCount reports whether the write persisted: block mode
 * must allow the stop when it did not, or an unwritable tmpdir would block forever.
 * On the first write of a session, state files older than 24h are removed (bounded scan).
 *
 * Exports: readCount, readChain, incrementCount(sessionId, turnKey, {active}) -> {count, chain, persisted},
 *          stateFile(sessionId), pruneStaleStateFiles(now)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const PREFIX = 'rig-verify-guard-';
const STALE_MS = 24 * 60 * 60 * 1000;
const MAX_PRUNE_SCAN = 500;

/** Session ids become part of a file name: keep a safe charset, bounded length. */
function stateFile(sessionId) {
  const safe = String(sessionId || 'no-session').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  return path.join(os.tmpdir(), `${PREFIX}${safe}.json`);
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

/** Consecutive nudges issued while stop_hook_active was true (any turnKey). */
function readChain(sessionId) {
  return positiveInt(readState(sessionId).chain);
}

/** Removes `rig-verify-guard-*` files in tmpdir not modified for 24h. Best effort, bounded. */
function pruneStaleStateFiles(now = Date.now()) {
  try {
    const dir = os.tmpdir();
    for (const name of fs.readdirSync(dir).slice(0, MAX_PRUNE_SCAN)) {
      if (!name.startsWith(PREFIX)) continue;
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
  const file = stateFile(sessionId);
  const tmp = `${file}.${process.pid}.tmp`;
  let persisted = false;
  try {
    if (!fs.existsSync(file)) pruneStaleStateFiles();
    fs.writeFileSync(tmp, JSON.stringify({ turnKey, count, chain }), { mode: 0o600 });
    fs.renameSync(tmp, file);
    persisted = true;
  } catch {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
  }
  return { count, chain, persisted };
}

module.exports = { readCount, readChain, incrementCount, stateFile, pruneStaleStateFiles };
