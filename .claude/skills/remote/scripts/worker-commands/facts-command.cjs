'use strict';
/** worker `facts`: payload {target} -> read-only doctor facts (see worker-machine-facts). */
const { usageError } = require('../lib/remote-errors.cjs');
const { collectFacts } = require('../lib/worker-machine-facts.cjs');
const { readRigVersion } = require('./info-command.cjs');

async function run(_argv, ctx) {
  const target = ctx.payload && ctx.payload.target;
  if (!target || typeof target !== 'object') throw usageError('facts needs payload {target}');
  ctx.reply({ rigVersion: readRigVersion(), ...collectFacts(target) });
  return 0;
}

module.exports = { run };
