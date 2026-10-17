'use strict';
/**
 * worker `start`: payload {spec, target, task} -> detached run. Replies at
 * once with {runId, state:'starting', method}; never waits for a pid or
 * trusts the launcher (schtasks may print SUCCESS and never run).
 * Idempotent by runId + spec hash.
 */
const { RemoteError, EXIT } = require('../lib/remote-errors.cjs');
const { intakeRun, failUnlaunched } = require('../lib/worker-run-intake.cjs');
const { launchRun } = require('../lib/detached-process-launcher.cjs');
const { readRunState } = require('../lib/run-directory.cjs');

async function run(_argv, ctx) {
  const { dir, run: rec, existing } = intakeRun(ctx.payload);
  const runId = rec.spec.runId;
  if (existing) {
    ctx.reply({ runId, state: readRunState(dir).state, method: 'existing' });
    return 0;
  }
  let launched;
  try {
    launched = launchRun({ runId, runDir: dir, target: rec.target });
  } catch (e) {
    failUnlaunched(rec, dir, `launch failed: ${e.message}`);
    throw new RemoteError(`cannot launch run ${runId}: ${e.message}`, EXIT.ERROR, { class: 'launch-failed', hint: String(e.stderr || '').trim().slice(-300) || null });
  }
  ctx.reply({ runId, state: 'starting', method: launched.method });
  return 0;
}

module.exports = { run };
