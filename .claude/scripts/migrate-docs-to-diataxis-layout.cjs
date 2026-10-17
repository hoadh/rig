#!/usr/bin/env node
/**
 * Migrate a legacy flat docs/ folder to the Diataxis layout, rewriting links.
 *
 * Usage:
 *   node .claude/scripts/migrate-docs-to-diataxis-layout.cjs [docs-dir] [--map <from>=<to> ...] [--apply]
 *
 * Default is dry-run (prints plan, changes nothing). --apply moves files
 * (git mv inside a git work tree, else rename) and rewrites links:
 *   - inbound links in docs/**.md + root README.md/CLAUDE.md/AGENTS.md
 *   - outbound relative links inside moved files
 *   - plain-text mentions like `docs/system-architecture.md`
 * --map adds custom moves (paths relative to docs dir, target under a Diataxis
 * dir or project/); a --map for a legacy file overrides its default target.
 * Never overwrites an existing target; conflicts are reported. Does not create
 * docs/README.md or split files (LLM work, see /rig:docs).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { detectLegacyLayout, findMarkdownFilesRecursive } = require('./docs-diataxis-layout.cjs');
const { mapPath, rewriteLinks, rewritePlainPaths } = require('./migrate-docs-link-rewrite-helpers.cjs');
const { extractMapArgs, parseCustomMoves } = require('./migrate-docs-custom-move-map-parser.cjs');

const ROOT_FILES = ['README.md', 'CLAUDE.md', 'AGENTS.md'];

const isInside = (p, dir) => p.startsWith(dir + path.sep);

/**
 * Split legacy + custom moves into executable moves and conflicts (never overwrite).
 * Custom moves override legacy defaults for the same source. Dir moves are planned
 * first so overlap checks only compare against moves that will really happen.
 */
function planMoves(docsDir, customMoves = []) {
  const moves = [];
  const conflicts = [];
  const custom = new Set(customMoves.map(c => c.from));
  const candidates = [...customMoves, ...detectLegacyLayout(docsDir).filter(l => !custom.has(l.from))]
    .sort((a, b) => (b.type === 'dir') - (a.type === 'dir'));
  for (const { from, to, type } of candidates) {
    const src = path.join(docsDir, from);
    const dst = path.join(docsDir, to);
    const dirs = moves.filter(m => m.isDir);
    // Overlap with an accepted dir move would break link mapping or overwrite a moved file.
    const overlaps = (type === 'dir' && isInside(dst, src)) || dirs.some(d =>
      isInside(src, d.src) || isInside(dst, d.src) || isInside(dst, d.dst) ||
      (type === 'dir' && (isInside(d.src, src) || isInside(d.dst, dst))));
    if (overlaps) conflicts.push({ from, to, reason: 'overlaps a directory move; move separately' });
    else if (moves.some(m => m.dst === dst)) conflicts.push({ from, to, reason: 'target claimed by an earlier move; merge manually' });
    else if (fs.existsSync(dst)) conflicts.push({ from, to, reason: 'target exists' });
    else moves.push({ from, to, src, dst, isDir: type === 'dir' });
  }
  return { moves, conflicts };
}

function isInsideGitWorkTree(dir) {
  const r = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() === 'true';
}

/** Abort before any move if a target's nearest existing ancestor is not a directory. */
function assertTargetParentsUsable(moves) {
  for (const m of moves) {
    let p = path.dirname(m.dst);
    while (!fs.existsSync(p)) p = path.dirname(p);
    if (!fs.statSync(p).isDirectory()) {
      throw new Error(`cannot create ${m.to}: ${path.relative(path.dirname(m.dst), p) || p} is a file; nothing moved`);
    }
  }
}

function applyMove(m, useGit, notes) {
  if (fs.existsSync(m.dst)) throw new Error(`target appeared before move, refusing to overwrite: ${m.to}`);
  fs.mkdirSync(path.dirname(m.dst), { recursive: true });
  if (useGit) {
    const r = spawnSync('git', ['mv', m.src, m.dst], { cwd: path.dirname(m.src), encoding: 'utf8' });
    if (r.status === 0) return;
    notes.push(`git mv failed for ${m.from} (${(r.stderr || '').trim()}); used rename`);
  }
  fs.renameSync(m.src, m.dst);
}

/**
 * Plan (and optionally apply) the migration. Returns a summary object.
 */
function migrate(docsDir, { apply = false, includeRootFiles = true, customMoves = [] } = {}) {
  const rootDir = path.dirname(docsDir);
  const docsName = path.basename(docsDir);
  const rel = p => path.relative(rootDir, p).split(path.sep).join('/');
  const { moves, conflicts } = planMoves(docsDir, customMoves);

  // Compute all rewrites against the OLD state before touching disk.
  const files = [
    ...findMarkdownFilesRecursive(docsDir),
    ...(includeRootFiles ? ROOT_FILES.map(f => path.join(rootDir, f)).filter(f => fs.existsSync(f)) : [])
  ];
  const changes = [];
  let linkRewrites = 0;
  if (moves.length) {
    for (const oldFile of files) {
      const original = fs.readFileSync(oldFile, 'utf8');
      const newFile = mapPath(oldFile, moves);
      const a = rewriteLinks(original, oldFile, newFile, moves);
      const b = rewritePlainPaths(a.content, moves, docsName);
      if (b.content !== original) {
        changes.push({ newFile, content: b.content });
        linkRewrites += a.count + b.count;
      }
    }
  }

  const notes = [];
  if (apply) {
    assertTargetParentsUsable(moves);
    const useGit = isInsideGitWorkTree(docsDir);
    const done = [];
    try {
      for (const m of moves) { applyMove(m, useGit, notes); done.push(m); }
      for (const c of changes) fs.writeFileSync(c.newFile, c.content);
    } catch (err) {
      const moved = done.map(m => `${m.from} -> ${m.to}`).join(', ') || 'none';
      throw new Error(`${err.message} (partial state; moves done: ${moved}; link rewrites may be incomplete)`);
    }
  }

  return {
    mode: apply ? 'apply' : 'dry-run',
    moved: moves.map(m => ({ from: `${docsName}/${m.from}`, to: `${docsName}/${m.to}` })),
    conflicts: conflicts.map(c => ({ from: `${docsName}/${c.from}`, to: `${docsName}/${c.to}`, reason: c.reason })),
    filesRewritten: changes.map(c => rel(c.newFile)),
    linkRewrites,
    notes
  };
}

function isInsideOrEqual(base, dir) {
  const r = path.relative(base, dir);
  return !r.startsWith('..') && !path.isAbsolute(r);
}

function main(argv) {
  let parsed;
  try { parsed = extractMapArgs(argv); } catch (err) { console.error(err.message); return 1; }
  const apply = parsed.rest.includes('--apply');
  const positional = parsed.rest.filter(a => !a.startsWith('-'));
  const docsDir = path.resolve(process.cwd(), positional[0] || 'docs');
  const rel = path.relative(process.cwd(), docsDir);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    console.error(`Refusing docs dir outside cwd (or equal to cwd): ${docsDir}`);
    return 1;
  }
  if (!fs.existsSync(docsDir) || !fs.statSync(docsDir).isDirectory()) {
    console.error(`Docs dir not found: ${docsDir}`);
    return 1;
  }
  try {
    const customMoves = parseCustomMoves(parsed.maps, docsDir);
    const summary = migrate(docsDir, { apply, customMoves, includeRootFiles: isInsideOrEqual(process.cwd(), path.dirname(docsDir)) });
    console.log(`Diataxis docs migration (${summary.mode})`);
    summary.moved.forEach(m => console.log(`  move     ${m.from} -> ${m.to}`));
    summary.conflicts.forEach(c => console.log(`  conflict ${c.from} -> ${c.to}: ${c.reason}`));
    summary.filesRewritten.forEach(f => console.log(`  rewrite  ${f}`));
    if (!apply) console.log('Dry-run only. Re-run with --apply to execute.');
    console.log(JSON.stringify(summary, null, 2));
    return 0;
  } catch (err) {
    console.error(`Migration failed: ${err.message}`);
    return 1;
  }
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { migrate, planMoves, mapPath, rewriteLinks, rewritePlainPaths };
