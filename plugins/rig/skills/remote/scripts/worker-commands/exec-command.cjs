'use strict';
/**
 * worker `exec`: same runner as `start` but in the foreground (the ssh
 * session stays open until the run ends). User/agent output goes to the run
 * `log` only - protocol stdout carries just the one framed reply.
 */
const path = require('path');
const { RemoteError, EXIT } = require('../lib/remote-errors.cjs');
const { intakeRun } = require('../lib/worker-run-intake.cjs');
const { readJson, tailFile } = require('../lib/run-directory.cjs');
const { runRun } = require('../worker-run-entry.cjs');

async function run(_argv, ctx) {
  const { dir, run: rec, existing } = intakeRun(ctx.payload);
  if (existing) throw new RemoteError(`run ${rec.spec.runId} already exists`, EXIT.ERROR, { class: 'exists', hint: 'exec needs a fresh runId; use status for existing runs' });
  await runRun(dir);
  const exit = readJson(path.join(dir, 'exit')) || { code: 1, failure: 'prepare' };
  ctx.reply({ runId: rec.spec.runId, exit: exit.code, failure: exit.failure, logTail: tailFile(path.join(dir, 'log'), 40) });
  return 0;
}

module.exports = { run };
