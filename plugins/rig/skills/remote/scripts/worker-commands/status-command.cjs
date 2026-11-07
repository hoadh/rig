'use strict';
/** worker `status <runId>`: state derived from run-dir files + result.json + logTail(40). One ssh round-trip. */
const path = require('path');
const { RemoteError, EXIT, usageError } = require('../lib/remote-errors.cjs');
const R = require('../lib/run-directory.cjs');
const { finalizeIfNeverStarted } = require('../lib/run-force-finalizer.cjs');
const { cleanupFinishedTask } = require('../lib/detached-process-launcher.cjs');

async function run(argv, ctx) {
  if (argv.length !== 1) throw usageError('usage: status <runId>');
  const dir = R.runDirOf(argv[0]);
  if (!R.exists(path.join(dir, 'run.json'))) throw new RemoteError(`unknown run ${argv[0]}`, EXIT.ERROR, { class: 'not-found' });
  finalizeIfNeverStarted(dir); // launcher never fired: write `exit` so a late runner refuses to start
  const summary = R.summarizeRun(dir);
  if (R.exists(path.join(dir, 'exit'))) cleanupFinishedTask(summary.runId); // windows backstop for DeleteExpiredTaskAfter
  ctx.reply({ ...summary, result: R.readJson(path.join(dir, 'result.json')), logTail: R.tailFile(path.join(dir, 'log'), 40) });
  return 0;
}

module.exports = { run };
