#!/usr/bin/env node
'use strict';
/**
 * Internal (not a bin entry): refresh ~/.claude/rig/runtime from the plugin install this script lives in.
 * `rig-remote upgrade` runs it over plain ssh after `claude plugin update`, because the worker script of the
 * old runtime is the thing being replaced and no Claude Code session starts on the worker to do it.
 *
 *   node <installPath>/scripts/refresh-runtime-copy.cjs [--json]
 *
 * Same copy a session start does (hooks/lib/runtime-copy-to-user-dir.cjs: staged swap, VERSION last, no
 * downgrade). Unlike `rig-init --runtime` it needs no terminal and never touches settings.json: it writes
 * nothing outside ~/.claude/rig/. The plugin root is this file's own realpath, never an env var, so nothing in
 * the environment can point the copy at another tree.
 * Exit: 0 copied|current, 1 busy (another copy running) or error, 2 usage, 3 a newer runtime is present (kept, no downgrade).
 */
const fs = require('fs');
const path = require('path');
const { copyRuntime } = require('../hooks/lib/runtime-copy-to-user-dir.cjs');

const EXIT_NEWER = 3;

/** @param {string[]} argv @param {{pluginRoot?: string, home?: string, out?: {write: Function}}} [opts] test seams @returns {number} exit code */
function main(argv, { pluginRoot = fs.realpathSync(path.resolve(__dirname, '..')), home, out = process.stdout } = {}) {
  const unknown = argv.filter((a) => a !== '--json');
  if (unknown.length) {
    process.stderr.write(`usage: refresh-runtime-copy.cjs [--json] (unknown argument ${JSON.stringify(unknown[0])})\n`);
    return 2;
  }
  const json = argv.includes('--json');
  let res;
  try {
    res = copyRuntime({ pluginRoot, ...(home ? { home } : {}) });
  } catch (err) {
    process.stderr.write(`refresh-runtime-copy: ${err.message}\n`);
    return 1;
  }
  out.write(json ? `${JSON.stringify({ status: res.status === 'newer' ? 'newer-present' : res.status, version: res.version, dir: res.dir })}\n`
    : `runtime ${res.status === 'newer' ? 'newer-present' : res.status}: ${res.version} (${res.dir})\n`);
  if (res.status === 'newer') return EXIT_NEWER;
  return res.status === 'busy' ? 1 : 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { main, EXIT_NEWER };
