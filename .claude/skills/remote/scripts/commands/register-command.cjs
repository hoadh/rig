'use strict';
/**
 * register <machine> --repo <abs clone path>   (existing machine: add this project's clone)
 * register <machine> --ssh <user@host> --os macos|linux|windows --repo <abs clone path>
 *          [--shell s] [--node abs] [--claude abs] [--path-prepend "A;B"]
 *          [--allowed-tools "Bash(npm test:*) ..."] [--task-mode headless|interactive] [--replace]
 * Adds one validated entry to the machine registry (creates the file when missing). Local only, no ssh.
 * The clone path is also recorded under this project's origin (`repos`), so one machine can hold a
 * clone per project: on an existing id, `register <id> --repo <p>` run in another project adds that
 * project's clone without --replace. --replace rebuilds the entry but keeps other projects' clones.
 */
const { EXIT, usageError } = require('../lib/remote-errors.cjs');
const { parseFlags } = require('../lib/cli-flag-parser.cjs');
const V = require('../lib/identifier-validators.cjs');
const { buildMachineEntry, upsertMachine } = require('../lib/machine-registry-writer.cjs');
const { projectOriginUrl } = require('../lib/machine-repo-for-project-resolver.cjs');
const { normalizeOrigin } = require('../lib/git-origin-url-normalizer.cjs');

const USAGE = 'usage: register <machine> --repo <abs path> (in the project; adds it to an existing machine) | register <machine> --ssh <user@host> --os macos|linux|windows --repo <abs path> [--shell s] [--node abs] [--claude abs] [--path-prepend "A;B"] [--allowed-tools "T1 T2"] [--task-mode m] [--replace]';

const FLAG_TO_KEY = { ssh: 'ssh', os: 'os', shell: 'shell', node: 'node', claude: 'claude',
  'path-prepend': 'pathPrepend', 'allowed-tools': 'allowedTools', 'task-mode': 'taskMode' };

/** Entry keys the user actually passed (defaults like shell=bash must not count as a change). */
const givenEntryKeys = (flags) => Object.keys(FLAG_TO_KEY).filter((f) => flags[f] !== undefined).map((f) => FLAG_TO_KEY[f]);

async function run(argv) {
  const { flags, positional } = parseFlags(argv, {
    '--ssh': 'value', '--os': 'value', '--repo': 'value', '--shell': 'value', '--node': 'value', '--claude': 'value',
    '--path-prepend': 'value', '--allowed-tools': 'value', '--task-mode': 'value', '--replace': 'bool',
  });
  if (positional.length !== 1) throw usageError(USAGE);
  const name = V.assertMachineName(positional[0], 'machine');
  if (!flags.repo) throw usageError('--repo is required', USAGE);
  const origin = projectOriginUrl();
  const projectKey = origin ? normalizeOrigin(origin) : '';
  const entry = buildMachineEntry(flags);
  const r = upsertMachine(name, entry, { replace: flags.replace, projectKey, givenKeys: givenEntryKeys(flags) });
  const what = { added: `added ${name}`, replaced: `replaced ${name}`, 'project-added': `added project ${projectKey} -> ${flags.repo} to ${name}`,
    'project-updated': `updated project ${projectKey} -> ${flags.repo} on ${name}` }[r.action];
  process.stdout.write(`${what} in ${r.path}${r.created ? ' (new file)' : ''}\n`);
  if (r.firstReposMap) {
    process.stdout.write(`warning: other projects using ${r.previousRepo} on ${name} must now run \`remote.cjs register ${name} --repo ${r.previousRepo}\` in that project\n`);
  }
  process.stdout.write(`next: remote.cjs setup ${name}   (clone + baseline on the worker, then doctor)\n`);
  return EXIT.OK;
}

module.exports = { run };
