'use strict';
/**
 * Shared dispatch: `<sub>` -> `<dir>/<sub>-command.cjs` exporting
 * `async run(argv, ctx) -> exitCode`. Used by remote.cjs and worker.cjs.
 */
const fs = require('fs');
const path = require('path');
const { EXIT, RemoteError } = require('./remote-errors.cjs');
const { isSub } = require('./identifier-validators.cjs');

function listSubcommands(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('-command.cjs')).map((f) => f.slice(0, -'-command.cjs'.length)).sort();
  } catch {
    return [];
  }
}

function helpText(title, dir) {
  const subs = listSubcommands(dir);
  return `${title}\n\nUsage: <script> <subcommand> [args]\n\nSubcommands:\n${subs.map((s) => `  ${s}`).join('\n') || '  (none)'}\n`;
}

/** Load and run a subcommand; unknown or malformed names -> usage error (exit 2). */
async function dispatch(dir, sub, argv, ctx) {
  if (!isSub(sub) || !listSubcommands(dir).includes(sub)) {
    throw new RemoteError(`unknown subcommand ${JSON.stringify(sub)}`, EXIT.USAGE, {
      class: 'invalid-input', hint: `available: ${listSubcommands(dir).join(', ') || '(none)'}`,
    });
  }
  const mod = require(path.join(dir, `${sub}-command.cjs`));
  const code = await mod.run(argv, ctx);
  return Number.isInteger(code) ? code : EXIT.OK;
}

module.exports = { listSubcommands, helpText, dispatch };
