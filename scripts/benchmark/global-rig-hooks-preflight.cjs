'use strict';
/**
 * Preflight for the benchmark's rig arm. The child `claude` keeps the real HOME (the auth lives there), and the Rig
 * plugin's hooks yield to Rig 1.x hooks that are registered in the real `~/.claude/settings.json`: on such a machine the
 * rig arm would run WITHOUT Rig hooks (the isolated CLI never runs the 1.x copies) and the results would be wrong.
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
    throw new Error(`Rig arm: ${found.length} Rig 1.x hook(s) are registered in ${path.join(home, '.claude', 'settings.json')}; the plugin hooks would yield to them and the arm would run without Rig. Run \`rig-init --migrate\` (in a terminal) first.`);
  }
}

module.exports = { findGlobalRigHooks, assertNoGlobalRigHooks };
