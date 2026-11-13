/**
 * antigravity-session-id.cjs - one filename-safe session id derived from an Antigravity conversation id.
 *
 * The adapter hands it to Rig hooks as `session_id` / RIG_SESSION_ID and the Antigravity copy of
 * set-active-plan derives it from ANTIGRAVITY_CONVERSATION_ID, so both sides name the same
 * rig-session-<id>.json state file. Conversation ids are UUIDs; anything else is neutralised because the
 * id ends up in file names.
 */
const MAX_LENGTH = 64;

/** @param {unknown} conversationId @returns {string} sanitized id, or '' when nothing usable remains */
function sessionIdFrom(conversationId) {
  if (typeof conversationId !== 'string') return '';
  return conversationId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, MAX_LENGTH);
}

module.exports = { sessionIdFrom };
