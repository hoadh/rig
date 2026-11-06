'use strict';
/** `cancel <machine> <runId>`: ask the worker to cancel (kills the run's process tree, pushes nothing new). */
const { usageError, EXIT } = require('../lib/remote-errors.cjs');
const V = require('../lib/identifier-validators.cjs');
const client = require('../lib/orchestrator-run-client.cjs');

async function run(argv) {
  if (argv.length !== 2) throw usageError('usage: cancel <machine> <runId>');
  const r = await client.cancelRun(V.assertMachineName(argv[0], 'machine'), V.assertRunId(argv[1]));
  process.stdout.write(`${r.runId} ${r.state}${r.note ? ` (${r.note})` : ''}\n`);
  return EXIT.OK;
}

module.exports = { run };
