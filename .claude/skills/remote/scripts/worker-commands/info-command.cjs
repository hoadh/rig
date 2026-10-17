'use strict';
/** worker `info`: handshake facts only (protocol/version/node/platform). Doctor facts live in `facts`. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PROTOCOL_VERSION } = require('../lib/rig-json-nonce-framing.cjs');

/** Rig version from .claude/metadata.json or package.json when discoverable, else "unknown". */
function readRigVersion() {
  const claudeDir = path.resolve(__dirname, '..', '..', '..', '..'); // worker-commands -> scripts -> remote -> skills -> .claude
  for (const f of [path.join(claudeDir, 'metadata.json'), path.join(claudeDir, '..', 'package.json')]) {
    try {
      const v = JSON.parse(fs.readFileSync(f, 'utf8')).version;
      if (typeof v === 'string') return v;
    } catch { /* try next */ }
  }
  return 'unknown';
}

async function run(_argv, ctx) {
  ctx.reply({ protocol: PROTOCOL_VERSION, rigVersion: readRigVersion(), node: process.version, platform: os.platform() });
  return 0;
}

module.exports = { run, readRigVersion };
