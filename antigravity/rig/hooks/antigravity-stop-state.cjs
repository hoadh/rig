/**
 * antigravity-stop-state.cjs - adapter-side caps on Stop continuations, independent of the hook's own counters.
 *
 * Two caps, both per conversation:
 *   - per turn (conversation + turn id, see antigravity-transcript-to-claude.cjs): MAX_CONTINUATIONS_PER_TURN;
 *   - per conversation, any turn: MAX_PER_CONVERSATION_WINDOW continuations within WINDOW_MS. It does not depend on
 *     the turn id, so a continuation that the host records as a fresh explicit user input cannot reset it.
 * State lives only in PLUGIN_DATA/state (never os.tmpdir()), written atomically (temp file + rename). A state that
 * cannot be written makes the caller skip the continuation, so a broken disk can never produce an endless loop.
 */
const fs = require('fs');
const path = require('path');
const { sessionIdFrom } = require('./antigravity-session-id.cjs');

const MAX_CONTINUATIONS_PER_TURN = 2;
const MAX_PER_CONVERSATION_WINDOW = 4;
const WINDOW_MS = 60 * 60 * 1000;

const fileFor = (pluginData, conversationId) => path.join(pluginData, 'state', `agy-stop-${sessionIdFrom(conversationId)}.json`);

function readState(pluginData, conversationId) {
  try {
    const s = JSON.parse(fs.readFileSync(fileFor(pluginData, conversationId), 'utf8'));
    return s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
}

const recentTimes = (state, now) => (Array.isArray(state.times) ? state.times.filter((t) => Number.isFinite(t) && now - t < WINDOW_MS) : []);

function readCount(pluginData, conversationId, turnId) {
  const s = readState(pluginData, conversationId);
  return s.turnId === turnId && Number.isInteger(s.count) ? s.count : 0;
}

/** Continuations recorded for this conversation within the window. */
function recentContinuations(pluginData, conversationId, now = Date.now()) {
  return recentTimes(readState(pluginData, conversationId), now).length;
}

/** @returns {boolean} true when the new counts were persisted */
function bumpCount(pluginData, conversationId, turnId, now = Date.now()) {
  const file = fileFor(pluginData, conversationId);
  const tmp = `${file}.${process.pid}.${now}`;
  try {
    const state = readState(pluginData, conversationId);
    const count = (state.turnId === turnId && Number.isInteger(state.count) ? state.count : 0) + 1;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ turnId, count, times: [...recentTimes(state, now), now] }));
    fs.renameSync(tmp, file);
    return true;
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
    return false;
  }
}

module.exports = { readCount, recentContinuations, bumpCount, MAX_CONTINUATIONS_PER_TURN, MAX_PER_CONVERSATION_WINDOW, WINDOW_MS };
