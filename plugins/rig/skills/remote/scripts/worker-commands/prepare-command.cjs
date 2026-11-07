'use strict';
/**
 * worker `prepare`: payload {target:{repo}, originUrl, acceptExisting?, identity?:{name,email}}
 * -> create/verify the Rig-dedicated clone and its known-good baseline (see worker-dedicated-clone-bootstrapper).
 */
const { usageError } = require('../lib/remote-errors.cjs');
const { prepareDedicatedClone } = require('../lib/worker-dedicated-clone-bootstrapper.cjs');

async function run(_argv, ctx) {
  const p = ctx.payload;
  if (!p || !p.target || typeof p.target !== 'object') throw usageError('prepare needs payload {target, originUrl}');
  ctx.reply(prepareDedicatedClone({ repo: p.target.repo, originUrl: p.originUrl, acceptExisting: p.acceptExisting === true, identity: p.identity || null }));
  return 0;
}

module.exports = { run };
