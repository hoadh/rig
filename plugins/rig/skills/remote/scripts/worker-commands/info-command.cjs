'use strict';
/**
 * worker `info`: handshake facts only (protocol/version/node/platform/self machine id, scripts integrity hash
 * so `rig-remote upgrade` can prove the runtime matches). Doctor facts live in `facts`.
 */
const os = require('os');
const { PROTOCOL_VERSION } = require('../lib/rig-json-nonce-framing.cjs');
const { selfMachineId } = require('../lib/machine-registry.cjs');
const { readRigVersion } = require('../lib/rig-version-compat.cjs');
const { scriptsIntegrityHash } = require('../lib/skill-scripts-integrity-hash.cjs');

/** Hash of the worker scripts; null when a file cannot be read, so the handshake itself never breaks on it. */
function safeHash() {
  try { return scriptsIntegrityHash(); } catch { return null; }
}

async function run(_argv, ctx) {
  ctx.reply({ protocol: PROTOCOL_VERSION, rigVersion: readRigVersion(), node: process.version, platform: os.platform(), machine: selfMachineId(), integrityHash: safeHash() });
  return 0;
}

module.exports = { run, readRigVersion };
