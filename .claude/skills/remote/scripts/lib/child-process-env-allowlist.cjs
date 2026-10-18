'use strict';
/**
 * Environment allowlist for the claude agent and user-command children.
 * Drops everything else (SSH_AUTH_SOCK, GH_TOKEN, GITHUB_TOKEN, AWS_*,
 * NPM_TOKEN, GIT_* ...). The runner's own git push keeps the full env.
 */

const ALLOWED = [
  'PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'ComSpec', 'PATHEXT',
  'TEMP', 'TMP', 'TMPDIR', 'USER', 'LOGNAME', 'LANG', 'TERM',
  // Windows system folders: NuGet/dotnet restore throws "Value cannot be null (path1)" without them
  'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'ProgramData', 'CommonProgramFiles', 'CommonProgramFiles(x86)',
  'CommonProgramW6432', 'ALLUSERSPROFILE', 'SystemDrive', 'windir', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS',
  'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'CLAUDE_CONFIG_DIR',
  'XDG_CONFIG_HOME', // so the tmux-started runner hashes the same global git config as the ssh-session `baseline` (review M2)
  'http_proxy', 'https_proxy', 'no_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
];

/**
 * @param {NodeJS.ProcessEnv} parent source env
 * @param {{pathPrepend?: string[], platform?: string}} [opts]
 * @returns {Object<string,string>} filtered env; PATH = pathPrepend entries + inherited PATH
 */
function buildChildEnv(parent, { pathPrepend = [], platform = process.platform } = {}) {
  const win = platform === 'win32';
  const allowed = new Set(ALLOWED.map((k) => (win ? k.toUpperCase() : k)));
  const out = {};
  let inheritedPath = '';
  for (const [key, value] of Object.entries(parent)) {
    if (value === undefined) continue;
    const k = win ? key.toUpperCase() : key;
    if (k === 'PATH') { inheritedPath = value; continue; }
    if (allowed.has(k) || k.startsWith('LC_')) out[key] = value;
  }
  const delim = win ? ';' : ':';
  const pathKey = win ? 'Path' : 'PATH';
  out[pathKey] = [...pathPrepend, ...(inheritedPath ? [inheritedPath] : [])].join(delim);
  return out;
}

/**
 * Allowlisted subset of an env (names only; PATH included as-is). Used by the
 * launcher to hand auth env to a runner whose own env may lack it (tmux server).
 * @returns {Object<string,string>}
 */
function pickAllowedEnv(parent, { platform = process.platform } = {}) {
  const win = platform === 'win32';
  const allowed = new Set(ALLOWED.map((k) => (win ? k.toUpperCase() : k)));
  const out = {};
  for (const [key, value] of Object.entries(parent)) {
    if (value === undefined) continue;
    if (allowed.has(win ? key.toUpperCase() : key) || key.startsWith('LC_')) out[key] = value;
  }
  return out;
}

module.exports = { buildChildEnv, pickAllowedEnv, ALLOWED };
