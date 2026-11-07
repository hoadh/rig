#!/usr/bin/env node
'use strict';
/** rig:remote orchestrator CLI. Usage: remote.cjs <subcommand> [args]  (see --help). */
const path = require('path');
const { EXIT, RemoteError } = require('./lib/remote-errors.cjs');
const { helpText, dispatch } = require('./lib/subcommand-router.cjs');
const { selfMachineId } = require('./lib/machine-registry.cjs');

const COMMANDS_DIR = path.join(__dirname, 'commands');

async function main(argv) {
  const [sub, ...rest] = argv;
  if (!sub || sub === '--help' || sub === '-h') {
    process.stdout.write(helpText('rig:remote orchestrator', COMMANDS_DIR));
    return sub ? EXIT.OK : EXIT.USAGE;
  }
  return dispatch(COMMANDS_DIR, sub, rest, { self: selfMachineId() });
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (err) => {
    const known = err instanceof RemoteError;
    process.stderr.write(`error: ${err.message}\n`);
    if (known && err.hint) process.stderr.write(`hint: ${err.hint}\n`);
    if (!known) process.stderr.write(`${err.stack}\n`);
    process.exitCode = known ? err.exitCode : EXIT.ERROR;
  },
);
