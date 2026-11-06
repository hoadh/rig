'use strict';
/** worker `info`: handshake facts only (protocol/version/node/platform/self machine id). Doctor facts live in `facts`. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PROTOCOL_VERSION } = require('../lib/rig-json-nonce-framing.cjs');
const { selfMachineId } = require('../lib/machine-registry.cjs');

/**
 * Rig version: the plugin manifest (<root>/.claude-plugin/plugin.json), else the metadata.json a file install
 * writes next to the kit (<root>/metadata.json, same {name, version} shape), else "unknown".
 * `root` is the plugin root, or the `.claude` dir in a file install.
 */
function readRigVersion(root = path.resolve(__dirname, '..', '..', '..', '..')) { // worker-commands -> scripts -> remote -> skills -> root
  for (const file of [path.join(root, '.claude-plugin', 'plugin.json'), path.join(root, 'metadata.json')]) {
    try {
      const v = JSON.parse(fs.readFileSync(file, 'utf8')).version;
      if (typeof v === 'string' && v !== '') return v;
    } catch { /* try the next source */ }
  }
  return 'unknown';
}

async function run(_argv, ctx) {
  ctx.reply({ protocol: PROTOCOL_VERSION, rigVersion: readRigVersion(), node: process.version, platform: os.platform(), machine: selfMachineId() });
  return 0;
}

module.exports = { run, readRigVersion };
