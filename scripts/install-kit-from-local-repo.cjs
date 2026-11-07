#!/usr/bin/env node
/**
 * Retired: Rig 2.x ships as a Claude Code plugin, so this file installer no longer copies anything.
 * It prints how to install the plugin and where the last file installer lives, and exits 0.
 * The 1.x installer is on the `release/1.x` branch (tag v1.1.0). Existing 1.x installs are moved to the plugin with
 * `rig-init --migrate` (see `rig-init --plan`).
 */
const lines = [
  'The Rig file installer is retired: Rig 2.x is a Claude Code plugin.',
  '',
  'Install the plugin (in Claude Code):',
  '  /plugin marketplace add hoadh/rig',
  '  /plugin install rig@rig-marketplace',
  '',
  'Then run /rig:setup. It previews and prints the terminal commands for the rest.',
  '',
  'Already have Rig 1.x files in ~/.claude or a project? After installing the plugin, in a terminal:',
  '  rig-init --plan       # read-only preview',
  '  rig-init --migrate    # moves the 1.x files into ~/.claude/rig-backups/ (restorable)',
  '',
  'Still need the 1.x file installer? It lives on the release/1.x branch (tag v1.1.0):',
  '  git clone --branch release/1.x https://github.com/hoadh/rig.git',
];
console.log(lines.join('\n'));
