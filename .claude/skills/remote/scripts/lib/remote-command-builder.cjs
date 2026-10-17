'use strict';
/**
 * Builds the single string sent as the ssh remote command, and the per-shell
 * argv a worker uses to run a user command. The ssh string holds only
 * validated tokens (+ the registry node path, quoted when it has spaces);
 * all variable data travels as JSON on stdin.
 */
const { usageError } = require('./remote-errors.cjs');
const V = require('./identifier-validators.cjs');

/** Relative to sshd's cwd (= home) on every OS; forward slashes work everywhere. */
const WORKER_REL_PATH = '.claude/skills/remote/scripts/worker.cjs';

// Chars that break cmd /c, powershell or sh quoting (parentheses end cmd's `if (...)` blocks and
// break "Program Files (x86)" under cmd's /c quote rule). Reject instead of trying to escape.
const UNQUOTABLE = /["'`$;&|<>^%!()\r\n\t]/;

/**
 * Quote an executable for the remote shell. Bare/abs paths only; spaces get shell-specific quotes,
 * PowerShell always gets the call operator. Throws exit-2 on chars that cannot be quoted safely.
 */
function quoteExecutable(exe, shell) {
  if (typeof exe !== 'string' || exe.length === 0) throw usageError('executable must be a non-empty string');
  if (UNQUOTABLE.test(exe)) {
    throw usageError(`executable path ${JSON.stringify(exe)} contains a character that cannot be quoted safely for ${shell}`,
      'use a path without ( ) & ^ % ! " < > | (e.g. the 8.3 short path from `dir /x`, or install node/claude outside "Program Files (x86)")');
  }
  const quoted = exe.includes(' ') ? (shell === 'bash' ? `'${exe}'` : `"${exe}"`) : exe;
  // PowerShell parses a leading quoted string as an expression -> needs call operator.
  return shell === 'pwsh' || shell === 'powershell' ? `& ${quoted}` : quoted;
}

/**
 * @param {{shell:string, node?:string}} machine registry entry
 * @param {string} sub worker subcommand
 * @param {string[]} [args] extra tokens (validated)
 */
function buildWorkerInvocation(machine, sub, args = []) {
  V.assertSub(sub, 'worker subcommand');
  args.forEach((a) => V.assertInvocationToken(a, 'worker argument'));
  const tail = [WORKER_REL_PATH, sub, ...args].join(' ');
  const node = machine.node;
  if (!node) return `node ${tail}`; // relies on non-interactive PATH; doctor detects failure
  return `${quoteExecutable(node, machine.shell)} ${tail}`;
}

/** argv (no shell) to run a user command string under the machine's shell. */
function buildShellArgv(shell, cmd) {
  if (typeof cmd !== 'string' || cmd.length === 0) throw usageError('command must be a non-empty string');
  switch (shell) {
    case 'bash': return ['sh', '-c', cmd];
    case 'cmd':
      // Node quotes spawn args with \" escapes that cmd does not understand; with /s the outer quotes
      // Node adds are stripped correctly only if the command itself has none. Reject rather than mis-parse.
      if (cmd.includes('"')) throw usageError('commands for a cmd shell must not contain double quotes', 'use single quotes via powershell, or a script file on the worker');
      return ['cmd.exe', '/d', '/s', '/c', cmd];
    case 'pwsh':
    case 'powershell':
      return [shell, '-NoProfile', '-NonInteractive', '-Command', `$ProgressPreference='SilentlyContinue'; ${cmd}`];
    default: throw usageError(`unknown shell ${JSON.stringify(shell)}`);
  }
}

module.exports = { WORKER_REL_PATH, quoteExecutable, buildWorkerInvocation, buildShellArgv };
