'use strict';
/**
 * register <machine> --ssh <user@host> --os macos|linux|windows --repo <abs clone path>
 *          [--shell s] [--node abs] [--claude abs] [--path-prepend "A;B"]
 *          [--allowed-tools "Bash(npm test:*) ..."] [--task-mode headless|interactive] [--replace]
 * Adds one validated entry to the machine registry (creates the file when missing). Local only, no ssh.
 */
const { EXIT, usageError } = require('../lib/remote-errors.cjs');
const { parseFlags } = require('../lib/cli-flag-parser.cjs');
const V = require('../lib/identifier-validators.cjs');
const { buildMachineEntry, upsertMachine } = require('../lib/machine-registry-writer.cjs');

const USAGE = 'usage: register <machine> --ssh <user@host> --os macos|linux|windows --repo <abs path> [--shell s] [--node abs] [--claude abs] [--path-prepend "A;B"] [--allowed-tools "T1 T2"] [--task-mode m] [--replace]';

async function run(argv) {
  const { flags, positional } = parseFlags(argv, {
    '--ssh': 'value', '--os': 'value', '--repo': 'value', '--shell': 'value', '--node': 'value', '--claude': 'value',
    '--path-prepend': 'value', '--allowed-tools': 'value', '--task-mode': 'value', '--replace': 'bool',
  });
  if (positional.length !== 1) throw usageError(USAGE);
  const name = V.assertMachineName(positional[0], 'machine');
  for (const req of ['ssh', 'os', 'repo']) if (!flags[req]) throw usageError(`--${req} is required`, USAGE);
  const r = upsertMachine(name, buildMachineEntry(flags), { replace: flags.replace });
  const verb = r.replaced ? 'replaced' : 'added';
  process.stdout.write(`${verb} ${name} in ${r.path}${r.created ? ' (new file)' : ''}\n`);
  process.stdout.write(`next: remote.cjs setup ${name}   (clone + baseline on the worker, then doctor)\n`);
  return EXIT.OK;
}

module.exports = { run };
