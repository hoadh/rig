'use strict';
/** Warn (never block) when the installed Claude Code is older than the plugin floor (hooks.json exec form, bin/ on PATH). */
const { spawnSync } = require('child_process');
const { compareSemver } = require('../../hooks/lib/runtime-copy-to-user-dir.cjs');

const MIN_CC_VERSION = '2.1.292';

/** @returns {{status: 'ok'|'old'|'unknown', version: string|null, min: string}} */
function checkClaudeCodeVersion({ run = spawnSync } = {}) {
  const res = run('claude', ['--version'], { encoding: 'utf8', timeout: 5000, shell: process.platform === 'win32' });
  const m = res && !res.error && res.status === 0 ? /(\d+\.\d+\.\d+)/.exec(String(res.stdout)) : null;
  if (!m) return { status: 'unknown', version: null, min: MIN_CC_VERSION };
  return { status: compareSemver(m[1], MIN_CC_VERSION) < 0 ? 'old' : 'ok', version: m[1], min: MIN_CC_VERSION };
}

function describeVersionCheck(check) {
  if (check.status === 'old') return `Warning: Claude Code ${check.version} is older than ${check.min}; the Rig plugin needs ${check.min} or newer. Update Claude Code.`;
  if (check.status === 'unknown') return `Note: could not read the Claude Code version (is \`claude\` on PATH?); the Rig plugin needs ${check.min} or newer.`;
  return null;
}

module.exports = { MIN_CC_VERSION, checkClaudeCodeVersion, describeVersionCheck };
