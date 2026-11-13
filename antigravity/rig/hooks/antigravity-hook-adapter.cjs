#!/usr/bin/env node
/**
 * antigravity-hook-adapter.cjs <hook> - runs a ported Rig hook under Antigravity.
 *
 * Reads the Antigravity payload on stdin, translates it (antigravity-payload-to-claude.cjs), runs the unchanged
 * Rig hook as a child in the user's workspace (antigravity-hook-child.cjs), and translates the output back
 * (claude-output-to-antigravity.cjs). Hooks: session-init (SessionStart), dev-rules-reminder (PreInvocation,
 * first model call after a user message only), bash-safety-guard (PreToolUse), verify-completion-guard (Stop).
 *
 * Failure policy: print nothing (= allow / no context) on any adapter error, EXCEPT the guard: when the child
 * decided deny/ask but the decision cannot be translated, or a shell tool arrives without a command, the call
 * is denied and `translate-miss` is logged. `{}` is never printed: Antigravity treats it as deny.
 * Stop: only with PLUGIN_DATA, only for a normal end (NO_TOOL_CALL), never for subagents, capped per turn.
 * There is no print-mode (`agy -p`) signal in the payload; the cap and the hook's own counters are the only
 * limits there, and headless `ask` decisions are auto-denied by the host.
 */
const fs = require('fs');
const path = require('path');
const toClaude = require('./antigravity-payload-to-claude.cjs');
const out = require('./claude-output-to-antigravity.cjs');
const { runHookChild, resolveHookScript } = require('./antigravity-hook-child.cjs');
const { sessionIdFrom } = require('./antigravity-session-id.cjs');

const HOOKS_DIR = __dirname;
// Allowlist: hook name -> expected Antigravity event and child time limit (below the hooks.json timeout).
const HOOKS = {
  'session-init': { event: 'SessionStart', timeoutMs: 12000 },
  'dev-rules-reminder': { event: 'PreInvocation', timeoutMs: 8000 },
  'bash-safety-guard': { event: 'PreToolUse', timeoutMs: 4000 },
  'verify-completion-guard': { event: 'Stop', timeoutMs: 8000 },
};

function write(text) {
  if (!text) return;
  try {
    fs.writeSync(1, `${text}\n`);
  } catch {
    process.stdout.write(`${text}\n`);
  }
}

function logNote(hook, event, note, status, pluginData) {
  if (!pluginData) return; // the hook logger would fall back to the (read-only) plugin dir
  try {
    require('./lib/hook-logger.cjs').logHook(`agy-${hook}`, { event, note, status });
  } catch {}
}

/** Short, non-reversible tag of a conversation id for log lines. */
const convTag = (id) => require('crypto').createHash('sha256').update(String(id || '')).digest('hex').slice(0, 8);

function readPayload() {
  try {
    const text = fs.readFileSync(0, 'utf8').trim();
    const json = text ? JSON.parse(text) : null;
    return json && typeof json === 'object' && !Array.isArray(json) ? json : null;
  } catch {
    return null;
  }
}

function runGuard(ag, ctx) {
  const tool = toClaude.classifyTool(ag, ctx.workspace);
  if (tool.kind === 'shell') {
    if (tool.command === null) {
      logNote(ctx.hook, 'PreToolUse', 'translate-miss no-command', 'deny', ctx.pluginData);
      return write(out.guardDenyOutput('Rig safety guard could not read the command of this shell tool call; blocked.'));
    }
    const UNKNOWN_CWD = 'Rig safety guard could not resolve the Cwd of this command, so its directory-relative checks may not apply; confirm it.';
    const res = runHookChild({ ...ctx, script: ctx.script, payload: tool.payload });
    if (!res.ok && !res.stdout.trim()) {
      logNote(ctx.hook, 'PreToolUse', `child-failed ${res.reason} ${tool.cwdUnknown ? 'cwd-unknown ask' : 'fail-open'}`, 'error', ctx.pluginData);
      return tool.cwdUnknown ? write(out.guardAskOutput(UNKNOWN_CWD)) : undefined;
    }
    const g = out.guardOutput(res.stdout);
    if (!g.recognized) {
      logNote(ctx.hook, 'PreToolUse', 'translate-miss unreadable-decision', 'deny', ctx.pluginData);
      return write(out.guardDenyOutput('Rig safety guard returned a decision this adapter could not read; blocked.'));
    }
    // An unresolvable Cwd (L6): a deny stands, anything else becomes an ask, since the rules checked the workspace
    if (tool.cwdUnknown && g.decision !== 'deny') {
      logNote(ctx.hook, 'PreToolUse', 'cwd-unknown ask', 'ask', ctx.pluginData);
      return write(out.guardAskOutput(g.decision === 'force_ask' && g.reason ? `${g.reason} ${UNKNOWN_CWD}` : UNKNOWN_CWD));
    }
    return write(g.out);
  }
  if (tool.kind === 'read') {
    try {
      const hit = require('./antigravity-secret-path-check.cjs').checkSecretPaths(tool.paths, ctx.workspace, tool.includes);
      if (hit) {
        logNote(ctx.hook, 'PreToolUse', 'secret-path ask', 'ask', ctx.pluginData);
        write(out.guardAskOutput(hit.reason));
      }
    } catch (error) {
      logNote(ctx.hook, 'PreToolUse', `secret-check-failed ${error && error.name} fail-open`, 'error', ctx.pluginData);
    }
  }
}

function runStop(ag, ctx) {
  if (!ctx.pluginData || !ctx.sessionId) return; // no state dir or no conversation id: no loop protection, so no Stop
  // conv=<hash prefix> lets a live log show which conversation each Stop belonged to (never the raw id).
  const note = (text, status = 'skip') => logNote(ctx.hook, 'Stop', `conv=${convTag(ag.conversationId)} ${text}`, status, ctx.pluginData);
  if (ag.terminationReason !== 'NO_TOOL_CALL' || (typeof ag.error === 'string' && ag.error)) return note(`skip reason=${ag.terminationReason || 'none'}`);
  if (typeof ag.transcriptPath !== 'string' || !ag.transcriptPath) return note('skip no-transcript-path');
  const { convertTranscript, toJsonl } = require('./antigravity-transcript-to-claude.cjs');
  const stopState = require('./antigravity-stop-state.cjs');
  const conv = convertTranscript(ag.transcriptPath, ag.conversationId);
  if (!conv) return note('skip transcript-unusable');
  // isSubagent looks at the FIRST step only: a main transcript also holds SYSTEM_MESSAGE steps (our own injectSteps) after USER_INPUT.
  if (conv.isSubagent) return note('skip subagent');
  if (stopState.readCount(ctx.pluginData, ag.conversationId, conv.turnId) >= stopState.MAX_CONTINUATIONS_PER_TURN) return note('skip adapter-cap');
  // Conversation-level cap that does not depend on turnId: a continuation recorded as a new explicit user input
  // would change the turn id and reset the per-turn cap above.
  if (stopState.recentContinuations(ctx.pluginData, ag.conversationId) >= stopState.MAX_PER_CONVERSATION_WINDOW) return note('skip conversation-cap');

  const tmp = path.join(ctx.pluginData, 'state', `agy-transcript-${ctx.sessionId}.jsonl`);
  try {
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, toJsonl(conv.entries));
    const payload = toClaude.stop(ag, ctx.workspace, { transcriptPath: tmp, lastAssistantMessage: conv.lastAssistantMessage, turnId: conv.turnId });
    const res = runHookChild({ ...ctx, script: ctx.script, payload });
    const text = res.ok ? out.stopOutput(res.stdout) : '';
    if (text && stopState.bumpCount(ctx.pluginData, ag.conversationId, conv.turnId)) {
      note('run continue', 'ok');
      write(text);
    } else {
      note(`run no-continue child=${res.ok ? 'ok' : res.reason}`, 'ok');
    }
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function main() {
  const hook = process.argv[2];
  const spec = Object.prototype.hasOwnProperty.call(HOOKS, hook) ? HOOKS[hook] : null;
  const script = spec ? resolveHookScript(hook, HOOKS_DIR) : null;
  if (!script) return;
  const ag = readPayload();
  if (!ag) return;

  const workspace = toClaude.workspaceOf(ag);
  const pluginData = path.isAbsolute(process.env.PLUGIN_DATA || '') ? process.env.PLUGIN_DATA : '';
  const sessionId = sessionIdFrom(ag.conversationId);
  // In-process users (hook logger, secret globs) read these; the child gets the same values from childEnv().
  if (workspace) process.env.CLAUDE_PROJECT_DIR = workspace;
  if (pluginData) process.env.CLAUDE_PLUGIN_DATA = pluginData;
  else delete process.env.CLAUDE_PLUGIN_DATA;
  const ctx = { hook, script, workspace, pluginData, sessionId, timeoutMs: spec.timeoutMs };

  if (hook === 'bash-safety-guard') return runGuard(ag, ctx);
  if (hook === 'verify-completion-guard') return runStop(ag, ctx);
  if (hook === 'dev-rules-reminder' && ag.invocationNum !== 0) return;

  const payload = hook === 'session-init' ? toClaude.sessionStart(ag, workspace) : toClaude.preInvocation(ag, workspace);
  const res = runHookChild({ ...ctx, payload });
  if (!res.ok) return logNote(hook, spec.event, `child-failed ${res.reason}`, 'error', pluginData);
  const root = process.env.PLUGIN_ROOT || path.resolve(HOOKS_DIR, '..');
  write(out.contextOutput(res.stdout, hook === 'session-init' ? `Rig root: ${root}` : ''));
}

try {
  main();
} catch (error) {
  // fail open: nothing printed. The guard's fail-closed cases are handled inside runGuard.
  try {
    logNote('adapter', 'crash', `${(error && error.name) || 'Error'}`, 'error', process.env.PLUGIN_DATA);
  } catch {}
}
process.exit(0);
