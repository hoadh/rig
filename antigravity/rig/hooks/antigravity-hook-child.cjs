/**
 * antigravity-hook-child.cjs - runs one unchanged Rig hook script as a child process.
 *
 * The hooks call process.exit at top level, so they cannot be required in-process. The child gets the
 * translated payload on stdin, `cwd` and CLAUDE_PROJECT_DIR = the workspace (the hook's own cwd is the
 * plugin install dir), CLAUDE_PLUGIN_DATA = Antigravity's PLUGIN_DATA (removed when absent, so a stale value
 * from a parent Claude Code session never leaks in), RIG_SESSION_ID = the sanitized conversation id.
 * No host switch env var is set: hooks must not branch on the host.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MAX_BUFFER = 4 * 1024 * 1024;

/** Absolute child script, refused when it would resolve outside the hooks directory. */
function resolveHookScript(name, hooksDir) {
  const file = path.resolve(hooksDir, `${name}.cjs`);
  return path.dirname(file) === path.resolve(hooksDir) ? file : null;
}

function childEnv({ workspace, pluginData, sessionId }) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: workspace };
  delete env.CLAUDE_ENV_FILE; // session-init would write a Claude env file
  delete env.RIG_HOST;
  if (pluginData) env.CLAUDE_PLUGIN_DATA = pluginData;
  else delete env.CLAUDE_PLUGIN_DATA;
  if (sessionId) env.RIG_SESSION_ID = sessionId;
  else delete env.RIG_SESSION_ID;
  return env;
}

/**
 * @returns {{ok: boolean, stdout: string, reason?: string}} ok=false: spawn error, timeout or non-zero exit
 */
function runHookChild({ script, payload, workspace, pluginData, sessionId, timeoutMs }) {
  const cwd = workspace && fs.existsSync(workspace) ? workspace : process.cwd();
  const res = spawnSync(process.execPath, [script], {
    input: JSON.stringify(payload),
    cwd,
    env: childEnv({ workspace: cwd, pluginData, sessionId }),
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
  });
  if (res.error) return { ok: false, stdout: '', reason: res.error.code || res.error.name };
  if (res.status !== 0) return { ok: false, stdout: res.stdout || '', reason: `exit-${res.status}` };
  return { ok: true, stdout: res.stdout || '' };
}

module.exports = { runHookChild, resolveHookScript, childEnv };
