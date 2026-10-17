'use strict';
/**
 * Rewrites a test clone's `.git/config` wholesale before each reuse (review L6). Untrusted test code runs as
 * the same user and may have added url.*.insteadOf, remote.origin.pushurl, credential.*, core.* overrides
 * (sshCommand, fsmonitor, hooksPath...) that the next privileged fetch would honour. Only the layout keys
 * git itself wrote at clone time survive: core.<KEEP_CORE> and, for non-sha1 / reftable / worktree-config
 * clones, the allowlisted [extensions] keys (M1: dropping them breaks a sha256 origin clone). The origin
 * remote is re-created from the agent clone's url. A symlinked git dir entry or config is refused (the
 * caller must re-clone) instead of being written through; `config.worktree` is deleted.
 */
const fs = require('fs');
const path = require('path');
const { RunFailure } = require('./run-directory.cjs');

const KEEP = {
  core: new Set(['repositoryformatversion', 'filemode', 'bare', 'logallrefupdates', 'symlinks', 'ignorecase', 'precomposeunicode']),
  extensions: new Set(['objectformat', 'compatobjectformat', 'refstorage', 'worktreeconfig']),
};
const GITDIR = '.' + 'git';

/** Allowlisted `key = value` lines per plain (subsection-less) section of an existing config text. */
function keptLayoutLines(text) {
  const out = { core: [], extensions: [] };
  let cur = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    const sec = /^\[\s*([^\s\]"]+)\s*(?:"[^"]*")?\s*\]/.exec(line);
    if (sec) { const n = sec[1].toLowerCase(); cur = !line.includes('"') && KEEP[n] ? n : null; continue; }
    const kv = /^([A-Za-z][A-Za-z0-9-]*)\s*=\s*([A-Za-z0-9.:-]{1,24})$/.exec(line);
    if (cur && kv && KEEP[cur].has(kv[1].toLowerCase())) out[cur].push(`\t${kv[1]} = ${kv[2]}`);
  }
  return out;
}

/** core layout lines only (kept for callers/tests of the original API). */
const keptCoreLines = (text) => keptLayoutLines(text).core;

function assertNotSymlink(p, what) {
  let st = null;
  try { st = fs.lstatSync(p); } catch { return null; } // absent is fine
  if (st.isSymbolicLink()) throw new RunFailure('prepare', `${what} of the test clone is a symlink`, { hint: 'delete the test clone (<repo>-rig-test) so it is re-cloned' });
  return st;
}

/** @param {string} clone test clone work tree (git dir must be a real directory) */
function resetTestCloneConfig(clone, originUrl) {
  if (/[\0\r\n]/.test(originUrl)) throw new Error('origin url must be a single line');
  const dir = path.join(clone, GITDIR);
  const dst = assertNotSymlink(dir, 'git dir entry');
  if (dst && !dst.isDirectory()) throw new RunFailure('prepare', 'git dir entry of the test clone is not a directory', { hint: 'delete the test clone (<repo>-rig-test) so it is re-cloned' });
  const file = path.join(dir, 'config');
  assertNotSymlink(file, 'config');
  assertNotSymlink(path.join(dir, 'config.worktree'), 'config.worktree');
  let old = '';
  try { old = fs.readFileSync(file, 'utf8'); } catch { /* unreadable: start from the defaults below */ }
  const kept = keptLayoutLines(old);
  if (!kept.core.some((l) => /repositoryformatversion/i.test(l))) kept.core.unshift('\trepositoryformatversion = 0');
  let text = `[core]\n${kept.core.join('\n')}\n`;
  if (kept.extensions.length) text += `[extensions]\n${kept.extensions.join('\n')}\n`;
  text += `[remote "origin"]\n\turl = ${originUrl}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`;
  fs.rmSync(file, { force: true });
  fs.rmSync(path.join(dir, 'config.worktree'), { force: true }); // not part of a fresh clone; may carry overrides
  fs.writeFileSync(file, text, { mode: 0o600 });
}

module.exports = { resetTestCloneConfig, keptCoreLines, keptLayoutLines };
