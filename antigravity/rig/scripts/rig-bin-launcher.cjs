'use strict';
/**
 * Shared launcher for the plugin `bin/rig-*` entrypoints.
 *
 * Claude Code puts the plugin's bin/ on PATH for Bash tool calls, but it does NOT export
 * CLAUDE_PLUGIN_ROOT/CLAUDE_PLUGIN_DATA there (spike 2026-11-06). So every entrypoint finds the
 * kit root from its own real path: <root>/bin/rig-x -> <root>. The same layout holds in a 1.x file
 * install (<project or ~>/.claude/bin/rig-x), so one entrypoint serves both.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

/** Kit root (plugin root, or the `.claude` dir of a file install) for a bin file; symlinks are resolved first. */
function kitRootOf(binFile) {
  return path.resolve(path.dirname(fs.realpathSync(binFile)), '..');
}

/**
 * Spawn `command args` with inherited stdio and exit this process with its status: 127 when it cannot be started,
 * 128+n when the child died from signal n (so 130/143 reach the caller). Only this wrapper's pid is signalled by a
 * parent that kills a single pid, so the child can be orphaned then; acceptable for these short-lived tools.
 */
function runAndExit(command, args, options = {}) {
  const res = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (res.error) {
    process.stderr.write(`rig: cannot run ${command}: ${res.error.message}\n`);
    process.exit(127);
  }
  const signalExit = res.signal ? 128 + (os.constants.signals[res.signal] || 1) : 1;
  process.exit(res.status === null ? signalExit : res.status);
}

/** Run `node <root>/<relScript> ...args` (args default to the entrypoint's own argv). */
function runNodeScript(binFile, relScript, args = process.argv.slice(2)) {
  runAndExit(process.execPath, [path.join(kitRootOf(binFile), relScript), ...args]);
}

module.exports = { kitRootOf, runAndExit, runNodeScript };
