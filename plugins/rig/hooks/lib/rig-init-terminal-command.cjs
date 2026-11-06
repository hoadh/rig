'use strict';
/**
 * The command a user types in their own terminal to run rig-init.
 *
 * Claude Code puts the plugin bin/ on PATH only for its Bash tool, not for the user's shell, so a bare
 * `rig-init` is "command not found" in a terminal. Every message that tells the user to run rig-init
 * therefore prints the absolute bin path through node, which works in bash, zsh, PowerShell and cmd.
 */
const path = require('path');

/** @param {string} pluginRoot absolute plugin root (the dir holding bin/) @returns {string} */
function rigInitTerminalCommand(pluginRoot) {
  return `node "${path.join(pluginRoot, 'bin', 'rig-init')}"`;
}

module.exports = { rigInitTerminalCommand };
