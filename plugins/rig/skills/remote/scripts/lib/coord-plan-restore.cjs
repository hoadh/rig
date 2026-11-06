'use strict';
/**
 * Restore the coord branch tree into a plan dir (takeover). Everything read
 * from the remote is untrusted: tree entries and frontmatter ids are validated
 * BEFORE a single byte is written (any invalid -> RemoteError exit 1).
 */
const fs = require('fs');
const path = require('path');
const { RemoteError, EXIT } = require('./remote-errors.cjs');
const V = require('./identifier-validators.cjs');
const { parseFrontmatter } = require('./plan-frontmatter.cjs');
const { git, gitOrThrow, safeMessage } = require('./rig-local-worktree.cjs');

const SAFE_REL = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const GLOB_RE = /^[A-Za-z0-9._/*?-]+$/;
const FILE_MODES = new Set(['100644', '100755']);
const MAX_FILES = 500;
const MAX_BLOB_BYTES = 2 * 1024 * 1024;

const invalid = (msg) => new RemoteError(`coord tree rejected: ${msg}`, EXIT.ERROR, { class: 'coord-invalid', hint: 'nothing was written; inspect the remote rig-coord branch' });

/** Parse `git ls-tree -r -z` output into [{mode, type, sha, path}]. */
function parseLsTreeZ(buf) {
  return String(buf).split('\0').filter(Boolean).map((rec) => {
    const m = /^(\d{6}) (\w+) ([0-9a-f]{40})\t([\s\S]+)$/.exec(rec);
    if (!m) throw invalid(`unparseable ls-tree record ${JSON.stringify(rec.slice(0, 60))}`);
    return { mode: m[1], type: m[2], sha: m[3], path: m[4] };
  });
}

/** Path/mode checks on tree entries (pure). */
function validateEntries(entries) {
  if (entries.length > MAX_FILES) throw invalid(`more than ${MAX_FILES} files`);
  for (const e of entries) {
    const p = e.path;
    if (!FILE_MODES.has(e.mode) || e.type !== 'blob') throw invalid(`${JSON.stringify(p)} has mode ${e.mode} (symlink/gitlink/other not allowed)`);
    if (!SAFE_REL.test(p) || p.split('/').some((s) => s === '..' || s === '.' || s === '')) throw invalid(`unsafe path ${JSON.stringify(p)}`);
  }
}

const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/** Frontmatter id checks on file contents (pure): files is Map<rel, Buffer>. */
function validateFrontmatterIds(files) {
  const plan = files.get('plan.md');
  if (!plan) throw invalid('plan.md missing');
  const orch = parseFrontmatter(plan.toString('utf8')).orchestrator;
  if (orch && !V.isMachineName(orch)) throw invalid(`plan.md orchestrator ${JSON.stringify(orch)}`);
  for (const [rel, buf] of files) {
    const base = path.posix.basename(rel);
    if (!/^phase-.*\.md$/.test(base) || rel.includes('/')) continue;
    if (!/^phase-[0-9]{2}-[A-Za-z0-9._-]+\.md$/.test(base)) throw invalid(`bad phase file name ${base}`);
    V.assertPhaseId(base.slice(6, 8), 'phase id');
    const fm = parseFrontmatter(buf.toString('utf8'));
    if (fm.machine && !V.isMachineName(fm.machine)) throw invalid(`${rel} machine ${JSON.stringify(fm.machine)}`);
    for (const g of asList(fm.owns)) {
      if (typeof g !== 'string' || !GLOB_RE.test(g) || g.split('/').includes('..')) throw invalid(`${rel} owns glob ${JSON.stringify(g)}`);
    }
  }
}

/**
 * Read + validate the tree of `ref` (e.g. refs/remotes/origin/rig-coord/x).
 * @returns {Map<string, Buffer>} nothing touches disk
 */
function readCoordTree(repo, ref) {
  const ls = git(repo, ['ls-tree', '-r', '-z', '--full-tree', ref], { encoding: 'buffer' });
  if (ls.status !== 0) throw invalid(`cannot list ${ref}: ${safeMessage(ls.stderr)}`);
  const entries = parseLsTreeZ(ls.stdout.toString('utf8'));
  validateEntries(entries);
  const files = new Map();
  for (const e of entries) {
    const size = Number(gitOrThrow(repo, ['cat-file', '-s', e.sha]));
    if (size > MAX_BLOB_BYTES) throw invalid(`${e.path} larger than ${MAX_BLOB_BYTES} bytes`);
    files.set(e.path, gitOrThrow(repo, ['cat-file', 'blob', e.sha], { encoding: 'buffer' }));
  }
  validateFrontmatterIds(files);
  return files;
}

/** Write a validated file map into planDir (caller has moved any old dir away). */
function writeRestoredFiles(planDir, files) {
  for (const [rel, buf] of files) {
    const dest = path.join(planDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
  }
}

module.exports = { parseLsTreeZ, validateEntries, validateFrontmatterIds, readCoordTree, writeRestoredFiles };
