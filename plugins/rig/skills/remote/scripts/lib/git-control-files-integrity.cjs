'use strict';
/**
 * Integrity hash of git control files an agent could use to steer the
 * privileged push: `.git/config`, `.git/config.worktree`, `.git/hooks/**`,
 * `.git/info/**`, `.git/objects/info/alternates`, PLUS the user-level git config
 * the runner's git honours (see global-gitconfig-hash-inputs.cjs: ~/.gitconfig, ~/.config/git/config,
 * $XDG_CONFIG_HOME/git/config and every include/includeIf target, found textually; a same-user agent could add
 * credential.helper `!cmd` / insteadOf / include there; review M-B, M2, M3).
 * A missing global file hashes as a stable marker. After INTENTIONALLY editing global
 * gitconfig, re-run `worker.cjs baseline --repo <clone>` for each clone.
 * Packs/objects are deliberately excluded (gc rewrites them).
 * Quarantine marker lives in the git dir; prepare refuses a quarantined clone.
 */
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { fixedGlobalConfigFiles, globalConfigHashParts } = require('./global-gitconfig-hash-inputs.cjs');
const globalConfigFiles = () => fixedGlobalConfigFiles();

const QUARANTINE_FILE = 'rig-quarantine';

function gitDirOf(repo) {
  return execFileSync('git', ['-C', repo, 'rev-parse', '--absolute-git-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Sorted list of files under dir (relative posix paths); symlinks are listed, not followed. */
function walk(dir, rel = '') {
  let entries;
  try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return []; }
  return entries.flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? walk(dir, r) : [r];
  }).sort();
}

/** sha256 over (relative name, mode, content-or-link-target) of every control file. */
function hashGitControlFiles(repo) {
  const gitDir = gitDirOf(repo);
  const h = crypto.createHash('sha256');
  const files = ['config', 'config.worktree', 'objects/info/alternates', ...walk(gitDir, 'hooks'), ...walk(gitDir, 'info')];
  for (const rel of files) {
    const full = path.join(gitDir, rel);
    let st;
    try { st = fs.lstatSync(full); } catch { h.update(`${rel}\0missing\0`); continue; }
    h.update(`${rel}\0${st.mode}\0`);
    h.update(st.isSymbolicLink() ? fs.readlinkSync(full) : fs.readFileSync(full));
    h.update('\0');
  }
  for (const [label, marker] of globalConfigHashParts(repo)) h.update(`${label}\0${marker}\0`);
  return h.digest('hex');
}

const quarantinePath = (repo) => path.join(gitDirOf(repo), QUARANTINE_FILE);

function writeQuarantine(repo, reason) {
  fs.writeFileSync(quarantinePath(repo), `${new Date().toISOString()} ${reason}\n`);
}

function isQuarantined(repo) {
  try { return fs.existsSync(quarantinePath(repo)); } catch { return false; }
}

module.exports = { hashGitControlFiles, globalConfigFiles, writeQuarantine, isQuarantined, quarantinePath };
