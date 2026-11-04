/**
 * bash-safety-rule-engine.cjs - runs bash-safety rules over every segment of a command.
 *
 * Rule contract:
 *   { id, configKey, opaquePolicy: 'skip'|'inspect', crashPolicy: 'allow'|'ask',
 *     check(segment, ctx) -> null | { decision: 'deny'|'ask', reason, context? } }
 *
 *   - Every segment reaches the engine's loop, opaque ones included (segment.raw carries the
 *     text). `opaquePolicy: 'skip'` rules are not called for opaque segments; 'inspect' rules are.
 *   - A rule that throws follows its `crashPolicy`: 'allow' ignores it (reported in `crashes`),
 *     'ask' turns it into an ask so a stricter rule can fail closed.
 *   - The strongest decision wins (deny over ask; first of equal strength).
 *   - A tokenizer failure propagates: the entry hook treats that as a crash and fails open.
 *
 * ctx passed to rules: { cwd, cwdUnknown, fullCommand, platform }
 */
const { tokenize } = require('./bash-command-segment-tokenizer.cjs');

const MAX_REASON_CHARS = 300;

function clip(text) {
  const s = String(text || '');
  return s.length > MAX_REASON_CHARS ? `${s.slice(0, MAX_REASON_CHARS - 3)}...` : s;
}

/**
 * @param {string} command
 * @param {{rules: object[], cwd?: string, platform?: string, isRuleEnabled?: (rule: object) => boolean}} opts
 * @returns {{result: null | {decision: string, reason: string, context?: string, ruleId: string},
 *            crashes: Array<{ruleId: string, error: string}>}}
 */
function evaluateCommand(command, opts) {
  const { rules, cwd, platform = process.platform, isRuleEnabled = () => true } = opts;
  const active = rules.filter((rule) => isRuleEnabled(rule));
  const crashes = [];
  let best = null;
  if (active.length === 0) return { result: null, crashes };

  for (const segment of tokenize(command, { cwd })) {
    const ctx = { cwd: segment.cwd, cwdUnknown: segment.cwdUnknown, fullCommand: segment.fullCommand, platform };
    for (const rule of active) {
      if (segment.opaque && rule.opaquePolicy !== 'inspect') continue;
      let found;
      try {
        found = rule.check(segment, ctx);
      } catch (error) {
        // Only the error class/code is kept: messages from fs errors contain paths.
        crashes.push({ ruleId: rule.id, error: `${(error && error.name) || 'Error'}:${(error && error.code) || ''}` });
        found = rule.crashPolicy === 'ask'
          ? { decision: 'ask', reason: `Safety rule ${rule.id} could not evaluate this command; confirm it manually.` }
          : null;
      }
      if (!found || (found.decision !== 'deny' && found.decision !== 'ask')) continue;
      if (!best || (found.decision === 'deny' && best.decision !== 'deny')) {
        best = { decision: found.decision, reason: clip(found.reason), context: found.context ? clip(found.context) : undefined, ruleId: rule.id };
      }
    }
  }
  return { result: best, crashes };
}

module.exports = { evaluateCommand, MAX_REASON_CHARS };
