'use strict';
/** Canonical branch / directory names for rig:remote, shared by all phases. */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const V = require('./identifier-validators.cjs');

const coordBranch = (slug) => `rig-coord/${V.assertSlug(slug)}`;
const workerBranch = (machine, slug) => `rig/${V.assertMachineName(machine)}/${V.assertSlug(slug)}`;
const integrationBranch = (slug) => `rig-int/${V.assertSlug(slug)}`;
const localRigDir = (repoRoot) => path.join(repoRoot, '.rig');

/**
 * Append `.rig/` to the repo's info/exclude once (works for worktrees: path
 * comes from `git rev-parse --git-path`). Returns true when it was added.
 */
function ensureRigDirExcluded(repoRoot) {
  const rel = execFileSync('git', ['-C', repoRoot, 'rev-parse', '--git-path', 'info/exclude'], { encoding: 'utf8' }).trim();
  const file = path.resolve(repoRoot, rel);
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (current.split(/\r?\n/).some((l) => l.trim() === '.rig/')) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${current && !current.endsWith('\n') ? '\n' : ''}.rig/\n`);
  return true;
}

module.exports = { coordBranch, workerBranch, integrationBranch, localRigDir, ensureRigDirExcluded };
