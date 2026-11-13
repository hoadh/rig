/**
 * antigravity-hooks-json.cjs - the generated plugin's hooks.json (Antigravity format) and the list of ported hooks.
 *
 * Format (agy-customizations hooks.md): top-level keys are hook names; PreToolUse is grouped (`matcher` + `hooks`),
 * SessionStart / PreInvocation / Stop are flat. Hook commands run with cwd = the plugin dir (probe-verified, and
 * `agy plugin validate --strict` requires the relative form: older hosts do not set ${PLUGIN_ROOT} for commands),
 * so the adapter is addressed as ./hooks/... . That is the plugin dir, never the workspace.
 * Timeouts (seconds): guard 5 and stop 10 as in the Claude plugin; the adapter's own child limits are lower.
 *
 * Not ported: SubagentStart, TeammateIdle (no Antigravity event), UserPromptSubmit (PreInvocation stands in).
 */
const ADAPTER = 'node ./hooks/antigravity-hook-adapter.cjs';

// matcher: shell tools plus the native read tools whose paths the secret check inspects.
const GUARD_TOOLS = 'run_command|send_command_input|read_file|view_file|view_file_outline|grep_search';

const handler = (hook, timeout) => ({ type: 'command', command: `${ADAPTER} ${hook}`, timeout });

const hooksJson = {
  'rig-session-init': { SessionStart: [handler('session-init', 15)] },
  'rig-dev-rules-reminder': { PreInvocation: [handler('dev-rules-reminder', 10)] },
  'rig-bash-safety-guard': { PreToolUse: [{ matcher: GUARD_TOOLS, hooks: [handler('bash-safety-guard', 5)] }] },
  'rig-verify-completion-guard': { Stop: [handler('verify-completion-guard', 10)] },
};

const portedHooks = ['session-init', 'dev-rules-reminder', 'bash-safety-guard', 'verify-completion-guard'];

module.exports = { hooksJson, portedHooks, GUARD_TOOLS };
