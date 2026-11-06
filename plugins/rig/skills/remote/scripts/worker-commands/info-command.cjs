'use strict';
/** worker `info`: handshake facts only (protocol/version/node/platform/self machine id). Doctor facts live in `facts`. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PROTOCOL_VERSION } = require('../lib/rig-json-nonce-framing.cjs');
const { selfMachineId } = require('../lib/machine-registry.cjs');

/** Rig version from the plugin manifest (.claude-plugin/plugin.json), else "unknown". */
function readRigVersion() {
  const pluginRoot = path.resolve(__dirname, '..', '..', '..', '..'); // worker-commands -> scripts -> remote -> skills -> plugin root
  try {
    const v = JSON.parse(fs.readFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8')).version;
    if (typeof v === 'string') return v;
  } catch { /* no manifest next to the scripts */ }
  return 'unknown';
}

async function run(_argv, ctx) {
  ctx.reply({ protocol: PROTOCOL_VERSION, rigVersion: readRigVersion(), node: process.version, platform: os.platform(), machine: selfMachineId() });
  return 0;
}

module.exports = { run, readRigVersion };
