'use strict';
/**
 * `run <machine> [--ref <sha>] [--detach] [--timeout s] -- <cmd...>`
 * Runs a user command in the machine's test worktree at an immutable sha
 * (default: origin/HEAD resolved via ls-remote). Foreground uses worker
 * `exec` (exit code mirrors the command); --detach prints the runId.
 */
const { usageError, EXIT } = require('../lib/remote-errors.cjs');
const { parseFlags } = require('../lib/cli-flag-parser.cjs');
const V = require('../lib/identifier-validators.cjs');
const { newRunId } = require('../lib/run-directory.cjs');
const client = require('../lib/orchestrator-run-client.cjs');

const DEFAULT_TIMEOUT_SEC = 1800;

async function run(argv, ctx) {
  const { flags, positional, rest } = parseFlags(argv, { '--ref': 'value', '--detach': 'bool', '--timeout': 'value' });
  if (positional.length !== 1 || rest.length === 0) throw usageError('usage: run <machine> [--ref <sha>] [--detach] [--timeout s] -- <cmd...>');
  const machine = V.assertMachineName(positional[0], 'machine');
  const timeoutSec = flags.timeout === undefined ? DEFAULT_TIMEOUT_SEC : Number(flags.timeout);
  if (!Number.isInteger(timeoutSec) || timeoutSec < 1 || timeoutSec > 86_400) throw usageError('--timeout must be 1..86400 seconds');
  const spec = {
    v: 1, runId: newRunId(), orchestrator: ctx.self, slug: null, phase: null, kind: 'command',
    ref: flags.ref ? V.assertSha(flags.ref, '--ref') : client.resolveOriginHeadSha(),
    command: rest.length === 1 ? rest[0] : rest.join(' '), timeoutSec,
  };
  if (flags.detach) {
    const r = await client.startRun(machine, spec, null);
    process.stdout.write(`${r.runId} ${r.state} (${r.method})\n`);
    return EXIT.OK;
  }
  const r = await client.execRun(machine, spec, null);
  if (r.logTail) process.stdout.write(`${r.logTail}\n`);
  process.stderr.write(`run ${r.runId} exit ${r.exit}${r.failure ? ` (${r.failure})` : ''}\n`);
  return r.exit === 0 ? EXIT.OK : EXIT.ERROR;
}

module.exports = { run };
