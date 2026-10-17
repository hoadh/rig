'use strict';
/**
 * worker `list [--slug s]`: reply {runs:[{runId, orchestrator, slug, phase, kind, state, exit,
 * failure, startedAt, heartbeatAt, head, pushed}]} - the contract phases 04/05 build on.
 */
const path = require('path');
const { usageError } = require('../lib/remote-errors.cjs');
const V = require('../lib/identifier-validators.cjs');
const R = require('../lib/run-directory.cjs');
const { finalizeIfNeverStarted } = require('../lib/run-force-finalizer.cjs');
const { cleanupFinishedTask } = require('../lib/detached-process-launcher.cjs');

async function run(argv, ctx) {
  let slug = null;
  if (argv.length) {
    if (argv.length !== 2 || argv[0] !== '--slug') throw usageError('usage: list [--slug <slug>]');
    slug = V.assertSlug(argv[1]);
  }
  const runs = [];
  for (const dir of R.listRunDirs()) {
    finalizeIfNeverStarted(dir);
    const s = R.summarizeRun(dir);
    if (R.exists(path.join(dir, 'exit'))) cleanupFinishedTask(s.runId);
    if (!slug || s.slug === slug) runs.push(s);
  }
  runs.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
  ctx.reply({ runs });
  return 0;
}

module.exports = { run };
