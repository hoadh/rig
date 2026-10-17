'use strict';
/**
 * Env for the claude agent and user-command children: allowlisted parent env
 * (no GIT_SSH_COMMAND / GIT_ASKPASS / GIT_CONFIG_GLOBAL / tokens) PLUS the git
 * hardening pins, appended AFTER filtering so the allowlist cannot strip them.
 * Result: an agent `git commit` (or any tool subprocess) never runs clone hooks.
 */
const os = require('os');
const { buildChildEnv } = require('./child-process-env-allowlist.cjs');
const { hardenedGitConfigEnv } = require('./hardened-git-config-env.cjs');
const { systemLineEndingPins } = require('./system-line-ending-config-forwarder.cjs');

function buildAgentChildEnv(parentEnv, target) {
  const env = buildChildEnv(parentEnv, { pathPrepend: (target && target.pathPrepend) || [] });
  if (!env.HOME && process.platform !== 'win32') env.HOME = os.homedir(); // task contexts may lack HOME
  // NOSYSTEM drops the system autocrlf/eol (Git for Windows); forward just those so the agent sees the runner's worktree view (D4).
  return { ...env, ...hardenedGitConfigEnv({ baseEnv: env, extraPins: systemLineEndingPins(parentEnv) }) };
}

module.exports = { buildAgentChildEnv };
