/**
 * verify-guard-turn-counter.cjs - per-session, per-turn nudge counter for the verify-completion-guard.
 *
 * The Stop hook must not rely on Claude Code's own continuation cap: it keeps its own count of how
 * many times it has nudged/blocked in the current turn, in a small temp file
 * `<tmpdir>/rig-verify-guard-<session_id>.json` = {turnKey, count}. A new turnKey resets the count.
 * All I/O is best effort; failures read as 0 / are ignored (a lost write costs at most one extra nudge).
 *
 * Exports: readCount(sessionId, turnKey), incrementCount(sessionId, turnKey), stateFile(sessionId)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

/** Session ids become part of a file name: keep a safe charset, bounded length. */
function stateFile(sessionId) {
  const safe = String(sessionId || 'no-session').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  return path.join(os.tmpdir(), `rig-verify-guard-${safe}.json`);
}

function readState(sessionId) {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(sessionId), 'utf8'));
    return s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
}

/** Nudges already issued in this turn (0 when the stored turn differs or nothing is stored). */
function readCount(sessionId, turnKey) {
  const s = readState(sessionId);
  return s.turnKey === turnKey && Number.isInteger(s.count) && s.count > 0 ? s.count : 0;
}

/** Records one more nudge for this turn; returns the new count. */
function incrementCount(sessionId, turnKey) {
  const count = readCount(sessionId, turnKey) + 1;
  const file = stateFile(sessionId);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify({ turnKey, count }), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
  }
  return count;
}

module.exports = { readCount, incrementCount, stateFile };
