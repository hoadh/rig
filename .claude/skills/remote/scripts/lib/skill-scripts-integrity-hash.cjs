'use strict';
/**
 * sha256 over the remote skill's scripts (relative path + bytes, sorted),
 * excluding tests. Doctor compares orchestrator vs worker: same Rig version
 * but different hash = tampered or half-updated install (fail).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCRIPTS_DIR = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['tests']);

function listFiles(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) out.push(...listFiles(dir, r)); } else if (e.name.endsWith('.cjs')) out.push(r);
  }
  return out.sort();
}

/** @returns {string} hex digest; line endings normalised so git autocrlf checkouts hash alike */
function scriptsIntegrityHash(dir = SCRIPTS_DIR) {
  const h = crypto.createHash('sha256');
  for (const rel of listFiles(dir)) {
    h.update(`${rel}\0`);
    h.update(fs.readFileSync(path.join(dir, rel), 'utf8').replace(/\r\n/g, '\n'));
    h.update('\0');
  }
  return h.digest('hex');
}

module.exports = { scriptsIntegrityHash };
