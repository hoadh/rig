'use strict';
/**
 * worker `cancel <runId>`: write the `cancelled` sentinel (the runner polls it
 * and kills its child tree). A run that is lost / never started has no runner
 * to notice (state lost/failed/starting = no heartbeat), so we kill its recorded
 * agent tree, stop its launcher wrapper and finish it ourselves (exit 130, failure
 * cancelled), release the busy marker and delete env.json. `exit` is created
 * only if absent, so a runner that was merely slow keeps its own result.
 */
const path = require('path');
const { RemoteError, EXIT, usageError } = require('../lib/remote-errors.cjs');
const R = require('../lib/run-directory.cjs');
const { forceFinalize } = require('../lib/run-force-finalizer.cjs');

async function run(argv, ctx) {
  if (argv.length !== 1) throw usageError('usage: cancel <runId>');
  const dir = R.runDirOf(argv[0]);
  const rec = R.readJson(path.join(dir, 'run.json'));
  if (!rec) throw new RemoteError(`unknown run ${argv[0]}`, EXIT.ERROR, { class: 'not-found' });
  const before = R.readRunState(dir);
  if (before.state === 'done' || (before.state === 'failed' && R.exists(path.join(dir, 'exit')))) {
    ctx.reply({ runId: argv[0], state: before.state, note: 'already finished' });
    return 0;
  }
  R.writeFileAtomic(path.join(dir, 'cancelled'), `${Date.now()}\n`);
  let finalizedHere = false;
  if (['lost', 'failed', 'starting'].includes(before.state)) {
    finalizedHere = forceFinalize(dir, rec, { failure: 'cancelled', code: 130, detail: `cancelled while ${before.state}` });
  }
  ctx.reply({ runId: argv[0], state: R.readRunState(dir).state, finalizedHere });
  return 0;
}

module.exports = { run };
