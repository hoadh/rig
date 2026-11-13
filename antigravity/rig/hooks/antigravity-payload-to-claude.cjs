/**
 * antigravity-payload-to-claude.cjs - pure translation of Antigravity hook payloads (camelCase) into the
 * Claude Code shapes the unchanged Rig hooks read (snake_case).
 *
 * Antigravity: `workspacePaths[0]` is the project, `cwd` the agent's directory, `conversationId` the session.
 * Each translator returns the child's stdin object. Tool classification for PreToolUse lives here too.
 */
const fs = require('fs');
const path = require('path');
const { sessionIdFrom } = require('./antigravity-session-id.cjs');

// Tools whose command line goes through the Bash guard. send_command_input types into a running terminal.
const SHELL_TOOLS = { run_command: 'CommandLine', send_command_input: 'Input' };
// Native read tools: any string arg named like a path is checked against the secret globs.
const READ_TOOLS = new Set(['read_file', 'view_file', 'view_file_outline', 'grep_search']);
const PATH_ARG = /(^|_|[a-z])(path|file|uri)$/i;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** @returns {string} project directory: first workspace path, else cwd, else '' (caller falls back) */
function workspaceOf(ag) {
  const ws = Array.isArray(ag.workspacePaths) ? ag.workspacePaths.find((p) => typeof p === 'string' && path.isAbsolute(p)) : '';
  if (ws) return ws;
  return typeof ag.cwd === 'string' && path.isAbsolute(ag.cwd) ? ag.cwd : '';
}

function base(ag, eventName, workspace) {
  return {
    session_id: sessionIdFrom(ag.conversationId),
    transcript_path: typeof ag.transcriptPath === 'string' ? ag.transcriptPath : '',
    cwd: workspace,
    hook_event_name: eventName,
  };
}

const sessionStart = (ag, workspace) => ({ ...base(ag, 'SessionStart', workspace), source: 'startup' });

// transcript_path stays empty on purpose: dev-rules-reminder skips the full block when its marker ("## Rig Session")
// is in the transcript tail, and our own injected SYSTEM_MESSAGE steps carry that marker, so a plan change
// between turns would never be emitted. The hook's signature state (plan + branch) is the dedupe here.
const preInvocation = (ag, workspace) => ({
  ...base(ag, 'UserPromptSubmit', workspace),
  transcript_path: '',
  prompt: typeof ag.lastUserInput === 'string' ? ag.lastUserInput : '',
});

/**
 * Where a run_command runs, for the guard's payload `cwd` (L6). The child process cwd and CLAUDE_PROJECT_DIR stay the
 * workspace either way, so project settings rules keep applying. No Cwd: the workspace. An absolute Cwd that exists:
 * that directory. Anything else (relative, missing, not a directory): unknown, never the plugin dir; the adapter then
 * asks (a guard deny still wins), because no rule can be trusted to have checked the right directory.
 * @returns {{cwd: string, unknown: boolean}}
 */
function commandCwd(args, workspace) {
  if (!Object.prototype.hasOwnProperty.call(args, 'Cwd') || args.Cwd === '' || args.Cwd === null || args.Cwd === undefined) return { cwd: workspace, unknown: false };
  const cwd = args.Cwd;
  try {
    if (typeof cwd === 'string' && path.isAbsolute(cwd) && fs.statSync(cwd).isDirectory()) return { cwd: path.resolve(cwd), unknown: false };
  } catch { /* missing: unknown below */ }
  return { cwd: workspace, unknown: true };
}

/**
 * send_command_input types into a terminal whose directory the payload does not give; it is checked against the
 * workspace (a known limit, see the feature map).
 * @returns {{kind: 'shell', command: string|null, payload: object, cwdUnknown?: boolean} | {kind: 'read', paths: string[], includes: string[]} | {kind: 'other'}}
 * A run_command without a string command yields command null: the adapter treats that as a translation miss.
 */
function classifyTool(ag, workspace) {
  const call = isObject(ag.toolCall) ? ag.toolCall : {};
  const name = typeof call.name === 'string' ? call.name : '';
  const args = isObject(call.args) ? call.args : {};
  if (Object.prototype.hasOwnProperty.call(SHELL_TOOLS, name)) {
    const raw = args[SHELL_TOOLS[name]];
    // send_command_input also terminates a command or waits (no Input): no text reaches the shell, so nothing to guard.
    if (name !== 'run_command' && (typeof raw !== 'string' || raw === '')) return { kind: 'other' };
    const command = typeof raw === 'string' && raw !== '' ? raw : null;
    const where = name === 'run_command' ? commandCwd(args, workspace) : { cwd: workspace, unknown: false };
    const payload = command === null ? null : {
      ...base(ag, 'PreToolUse', workspace),
      cwd: where.cwd,
      tool_name: 'Bash',
      tool_input: { command },
    };
    return { kind: 'shell', command, payload, cwdUnknown: where.unknown };
  }
  if (READ_TOOLS.has(name)) {
    const paths = Object.entries(args).filter(([k, v]) => PATH_ARG.test(k) && typeof v === 'string' && v !== '').map(([, v]) => v);
    // grep_search narrows by glob (`Includes: ['.env']` dumps a secret file without naming it as a path)
    const includes = Array.isArray(args.Includes) ? args.Includes.filter((v) => typeof v === 'string' && v !== '') : [];
    return { kind: 'read', paths, includes };
  }
  return { kind: 'other' };
}

/** Stop: the adapter supplies the converted transcript path and the last assistant message. */
const stop = (ag, workspace, { transcriptPath, lastAssistantMessage, turnId }) => ({
  ...base(ag, 'Stop', workspace),
  transcript_path: transcriptPath,
  last_assistant_message: lastAssistantMessage,
  stop_hook_active: ag.continuationActive === true,
  prompt_id: turnId,
});

module.exports = { workspaceOf, sessionStart, preInvocation, classifyTool, commandCwd, stop };
