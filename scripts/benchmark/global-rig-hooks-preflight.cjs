'use strict';
/**
 * Preflight for the benchmark's rig arm. The child `claude` keeps the real HOME (the auth lives there), so Rig 1.x hooks
 * registered in the real `~/.claude/settings.json` would run next to the plugin hooks (since 2.1.0 nothing yields):
 * every hook twice, and the results would be wrong.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const RIG_1X_HOOK = /[/\\]\.claude[/\\]hooks[/\\](?:session-init|dev-rules-reminder|bash-safety-guard|subagent-init|verify-completion-guard)\.cjs/;

/** @returns {string[]} the Rig 1.x hook commands found in a settings.json text */
function findGlobalRigHooks(settingsText) {
  let settings;
  try { settings = JSON.parse(settingsText); } catch { return []; }
  const commands = [];
  for (const entries of Object.values((settings && settings.hooks) || {})) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      for (const h of (entry && entry.hooks) || []) if (h && typeof h.command === 'string' && RIG_1X_HOOK.test(h.command)) commands.push(h.command);
    }
  }
  return commands;
}

/** Throws when the real HOME has Rig 1.x hooks registered globally. */
function assertNoGlobalRigHooks(home = os.homedir()) {
  let text;
  try { text = fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'); } catch { return; }
  const found = findGlobalRigHooks(text);
  if (found.length) {
    throw new Error(`Rig arm: ${found.length} Rig 1.x hook(s) are registered in ${path.join(home, '.claude', 'settings.json')}; they would run next to the plugin hooks (every hook twice). Remove them from settings.json first (Rig 2.1 does not migrate 1.x).`);
  }
}

module.exports = { findGlobalRigHooks, assertNoGlobalRigHooks };
