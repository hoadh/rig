'use strict';
/**
 * Coordination branch `rig-coord/<slug>` plumbing: remote state probe, fetch,
 * plan -> coord-worktree mirror (filtered + redacted), commit, plain push.
 * Plans are gitignored in projects, so this mirror is the ONLY way plan files
 * reach git. Fail-closed: anything we cannot verify is exit 3.
 */
const fs = require('fs');
const path = require('path');
const { RemoteError, EXIT } = require('./remote-errors.cjs');
const { isSha } = require('./identifier-validators.cjs');
const { coordBranch } = require('./rig-branch-and-path-names.cjs');
const { git, gitOrThrow, safeMessage } = require('./rig-local-worktree.cjs');
const { redactText } = require('./secret-redaction.cjs');

const SKIP_TOP_DIRS = new Set(['reports', 'visuals', 'spike']);
const MAX_FILE_BYTES = 1024 * 1024;
const SAFE_REL = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

const coordDirName = (slug) => `coord-${slug}`;
const coordRemoteRef = (slug) => `refs/remotes/origin/${coordBranch(slug)}`;

const unverifiable = (what, stderr) => new RemoteError(`cannot verify coord branch (${what}): ${safeMessage(stderr) || 'unknown error'}`, EXIT.LOCK, {
  class: 'coord-unverifiable', hint: 'check network / origin access; refusing to assume the plan is unclaimed',
});

/** @returns {{state:'missing'|'present', sha:string|null}}; any error -> RemoteError(3). */
function remoteCoordState(repoRoot, slug) {
  const r = git(repoRoot, ['ls-remote', '--exit-code', 'origin', `refs/heads/${coordBranch(slug)}`], { timeoutMs: 30000 });
  if (r.status === 2) return { state: 'missing', sha: null }; // --exit-code: 2 = no matching ref
  if (r.status !== 0) throw unverifiable('ls-remote', r.stderr);
  const sha = r.stdout.split(/\s+/)[0];
  if (!isSha(sha)) throw unverifiable('ls-remote', `unexpected output ${JSON.stringify(r.stdout.slice(0, 80))}`);
  return { state: 'present', sha };
}

/** Update refs/remotes/origin/rig-coord/<slug>; failure -> exit 3. */
function fetchCoord(repoRoot, slug) {
  const b = coordBranch(slug);
  const r = git(repoRoot, ['fetch', '-q', 'origin', `+refs/heads/${b}:${coordRemoteRef(slug)}`], { timeoutMs: 60000 });
  if (r.status !== 0) throw unverifiable('fetch', r.stderr);
}

/**
 * Files of a plan dir that may leave the machine, contents already redacted.
 * Skips: top-level reports/visuals/spike, *.log, dotfiles, symlinks, >1 MB,
 * names outside the safe charset (restore would reject them anyway).
 * @returns {{files: Map<string, Buffer>, warnings: string[], redactions: Array<{file:string, hits:Array}>}}
 */
function collectMirrorFiles(planDir) {
  const files = new Map(), warnings = [], redactions = [];
  const walk = (rel) => {
    const abs = rel ? path.join(planDir, rel) : planDir;
    for (const ent of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (ent.name.startsWith('.')) continue;
      const relPath = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isSymbolicLink()) { warnings.push(`skipped symlink ${relPath}`); continue; }
      if (ent.isDirectory()) { if (rel || !SKIP_TOP_DIRS.has(ent.name)) walk(relPath); continue; }
      if (!ent.isFile() || ent.name.endsWith('.log')) continue;
      if (!SAFE_REL.test(relPath)) { warnings.push(`skipped ${relPath}: name outside [A-Za-z0-9._-]`); continue; }
      const full = path.join(planDir, relPath);
      if (fs.statSync(full).size > MAX_FILE_BYTES) { warnings.push(`skipped ${relPath}: larger than 1 MB`); continue; }
      let buf = fs.readFileSync(full);
      if (!buf.includes(0)) { // text only; bytes (CRLF included) untouched unless a secret hit
        const r = redactText(buf.toString('utf8'));
        if (r.hits.length) { buf = Buffer.from(r.text, 'utf8'); redactions.push({ file: relPath, hits: r.hits }); }
      }
      files.set(relPath, buf);
    }
  };
  walk('');
  return { files, warnings, redactions };
}

/** Relative file paths currently in the coord worktree (excluding the .git link). */
function listWorktreeFiles(dir) {
  const out = [];
  const walk = (rel) => {
    for (const ent of fs.readdirSync(rel ? path.join(dir, rel) : dir, { withFileTypes: true })) {
      if (!rel && ent.name === '.git') continue;
      const p = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(p); else out.push(p);
    }
  };
  walk('');
  return out;
}

/** Commit identity fallback so a machine without git identity can still mirror. */
function identityArgs(dir) {
  return git(dir, ['config', 'user.email']).stdout.trim() ? [] : ['-c', 'user.name=rig-remote', '-c', 'user.email=rig-remote@localhost'];
}

/**
 * Make coordDir an exact filtered+redacted copy of planDir and commit if changed.
 * @param {{slug:string, self:string, now?: Date}} meta
 * @returns {{committed:boolean, warnings:string[], redactions:Array}}
 */
function mirrorPlanToCoord(planDir, coordDir, meta) {
  const { files, warnings, redactions } = collectMirrorFiles(planDir);
  for (const rel of listWorktreeFiles(coordDir)) {
    if (!files.has(rel)) fs.rmSync(path.join(coordDir, rel), { force: true }); // delete propagation
  }
  for (const [rel, buf] of files) {
    const dest = path.join(coordDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!fs.existsSync(dest) || !fs.readFileSync(dest).equals(buf)) fs.writeFileSync(dest, buf);
  }
  gitOrThrow(coordDir, ['add', '-A']);
  if (git(coordDir, ['diff', '--cached', '--quiet']).status === 0) return { committed: false, warnings, redactions };
  const stamp = (meta.now || new Date()).toISOString();
  gitOrThrow(coordDir, [...identityArgs(coordDir), 'commit', '-q', '-m', `coord: ${meta.slug} ${stamp} by ${meta.self}`]);
  return { committed: true, warnings, redactions };
}

/** Plain (never forced) push; a moved remote ref -> RemoteError(3,'coord-moved'). */
function pushCoord(coordDir, slug) {
  const r = git(coordDir, ['push', '-q', 'origin', `HEAD:refs/heads/${coordBranch(slug)}`], { timeoutMs: 60000 });
  if (r.status === 0) return;
  if (/rejected|non-fast-forward|fetch first|already exists/i.test(r.stderr)) {
    throw new RemoteError(`coord branch moved on remote: ${safeMessage(r.stderr)}`, EXIT.LOCK, {
      class: 'coord-moved', hint: 'another machine updated or claimed this plan; fetch and retry, or /rig:remote takeover',
    });
  }
  throw unverifiable('push', r.stderr);
}

module.exports = { coordDirName, coordRemoteRef, remoteCoordState, fetchCoord, collectMirrorFiles, mirrorPlanToCoord, pushCoord };
