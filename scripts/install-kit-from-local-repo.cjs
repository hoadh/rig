#!/usr/bin/env node
/**
 * Retired: Rig 2.x ships as a Claude Code plugin, so this file installer no longer copies anything.
 * It prints how to install the plugin and where the last file installer lives, and exits 0.
 * The 1.x installer is on the `release/1.x` branch (tag v1.1.0). Rig 2.1 has no 1.x migration; 1.x installs migrate
 * with Rig 2.0.10 (docs/how-to/migrate-from-rig-1x.md).
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
  'Already have Rig 1.x files in ~/.claude or a project? Rig 2.1 does not migrate them; use Rig 2.0.10:',
  '  https://github.com/hoadh/rig/blob/main/docs/how-to/migrate-from-rig-1x.md',
  '',
  'Still need the 1.x file installer? It lives on the release/1.x branch (tag v1.1.0):',
  '  git clone --branch release/1.x https://github.com/hoadh/rig.git',
];
console.log(lines.join('\n'));
