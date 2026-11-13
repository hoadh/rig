/**
 * claude-output-to-antigravity.cjs - pure translation of what a Rig hook printed (Claude Code shapes) into
 * Antigravity hook output. Every function returns the string to print ('' = print nothing).
 *
 * Antigravity rules (probe): PreToolUse `{}` DENIES, empty stdout allows, so "nothing to say" is always ''.
 * Context hooks print either hookSpecificOutput JSON (session-init) or plain text (dev-rules-reminder).
 */
const MAX_REASON = 600;

function parseJson(text) {
  try {
    const v = JSON.parse(text);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** Context text from child stdout: JSON additionalContext, or the plain text itself. '' when none. */
function contextText(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return '';
  const json = parseJson(text);
  if (!json) return text.startsWith('{') || text.startsWith('[') ? '' : text; // malformed JSON is not context
  const ctx = json.hookSpecificOutput && json.hookSpecificOutput.additionalContext;
  return typeof ctx === 'string' ? ctx.trim() : '';
}

/** systemMessage step; the nested object is required by Antigravity. */
function injectOutput(text) {
  if (!text) return '';
  return JSON.stringify({ injectSteps: [{ systemMessage: { systemMessage: text } }] });
}

/** @param {string} prefix lines placed before the hook's own context (e.g. the Rig root line) */
function contextOutput(stdout, prefix = '') {
  const text = contextText(stdout);
  return injectOutput([prefix, text].filter(Boolean).join('\n\n'));
}

/**
 * Guard output. deny -> deny, ask -> force_ask (ignores cached "always allow").
 * @returns {{out: string, recognized: boolean, decision?: string, reason?: string}} decision: '' (allow), 'deny' or
 * 'force_ask'. recognized=false: the child printed something we cannot read,
 * which the adapter must treat as a decision it failed to translate (fail closed).
 */
function guardOutput(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return { out: '', recognized: true, decision: '' };
  const hso = (parseJson(text) || {}).hookSpecificOutput;
  const decision = hso && hso.permissionDecision;
  if (decision !== 'deny' && decision !== 'ask') return { out: '', recognized: false };
  const parts = [hso.permissionDecisionReason, hso.additionalContext].filter((s) => typeof s === 'string' && s);
  const reason = [...new Set(parts)].join(' '); // the guard repeats the reason as context on ask
  const mapped = decision === 'deny' ? 'deny' : 'force_ask';
  return { out: JSON.stringify({ decision: mapped, reason: reason.slice(0, MAX_REASON) }), recognized: true, decision: mapped, reason: reason.slice(0, MAX_REASON) };
}

/** Failure result the adapter prints when a guard decision cannot be translated. */
const guardDenyOutput = (reason) => JSON.stringify({ decision: 'deny', reason });
const guardAskOutput = (reason) => JSON.stringify({ decision: 'force_ask', reason });

/** Stop: block -> continue + reason; remind (additionalContext) -> one continue with the nudge. */
function stopOutput(stdout) {
  const text = String(stdout || '').trim();
  const json = text ? parseJson(text) : null;
  if (!json) return '';
  const reason = json.decision === 'block' && typeof json.reason === 'string' ? json.reason : contextText(text);
  return reason ? JSON.stringify({ decision: 'continue', reason: reason.slice(0, MAX_REASON) }) : '';
}

module.exports = { contextText, injectOutput, contextOutput, guardOutput, guardDenyOutput, guardAskOutput, stopOutput };
