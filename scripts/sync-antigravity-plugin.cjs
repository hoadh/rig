#!/usr/bin/env node
/**
 * Generates the Antigravity plugin antigravity/rig/ from the Claude Code plugin plugins/rig/.
 *
 *   node scripts/sync-antigravity-plugin.cjs                   regenerate antigravity/rig/ (it is deleted first)
 *   node scripts/sync-antigravity-plugin.cjs --check           write nothing; exit 1 when antigravity/rig/ differs from a fresh build
 *   node scripts/sync-antigravity-plugin.cjs --check-leftovers check the committed antigravity/rig/ for Claude Code-only references
 *   node scripts/sync-antigravity-plugin.cjs --out <dir>       generate into <dir> instead (for tests and diffs)
 *
 * The build is done in memory and checked for leftovers before anything on disk is touched. What is built, and from what,
 * is described in scripts/antigravity/build-antigravity-plugin.cjs. The adapter hooks and scripts it copies are
 * hand-written in scripts/antigravity/hooks/ and scripts/antigravity/scripts/.
 */
const fs = require('fs');
const path = require('path');
const { buildOutputs, gitTrackedFiles, PLUGIN_SRC } = require('./antigravity/build-antigravity-plugin.cjs');
const { findLeftovers } = require('./antigravity/antigravity-output-leftover-check.cjs');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT = path.join(ROOT, 'antigravity', 'rig');
const toEntries = (outputs) => [...outputs].map(([p, o]) => ({ path: p, content: o.content, verbatim: o.verbatim }));

const binNames = (root, listFiles = gitTrackedFiles) => listFiles(root, `${PLUGIN_SRC}/bin`).map((rel) => path.basename(rel));

/** Text entries `{ path, text, verbatim }` of a list of `{ path, content, verbatim }`; binaries are skipped. */
const textEntries = (entries) => entries
  .filter(({ content }) => typeof content === 'string' || !content.includes(0))
  .map(({ path: p, content, verbatim }) => ({ path: p, text: content.toString('utf8'), verbatim }));

/** Throws with the list of leftovers; the message says how to fix them. */
function assertNoLeftovers(entries, root = ROOT, listFiles) {
  const leftovers = findLeftovers(textEntries(entries), { binNames: binNames(root, listFiles) });
  if (!leftovers.length) return;
  const lines = leftovers.slice(0, 30).map((l) => `  ${l.path}:${l.line}  [${l.id}]  ${l.text}`);
  const more = leftovers.length > 30 ? `\n  ... and ${leftovers.length - 30} more` : '';
  throw new Error(`${leftovers.length} Claude Code-only reference(s) left in the Antigravity output. Add a rewrite rule in scripts/antigravity/claude-to-antigravity-text-rewrite.cjs, or an allowlist entry in antigravity-output-leftover-check.cjs:\n${lines.join('\n')}${more}`);
}

function readTree(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) readTree(full, base, out);
    else out.push({ path: path.relative(base, full).split(path.sep).join('/'), content: fs.readFileSync(full), mode: fs.statSync(full).mode & 0o777 });
  }
  return out;
}

/** Differences between a fresh build and a directory: `{ missing, extra, changed }` (plugin-relative paths). */
function compareWithDisk(outputs, dir) {
  const onDisk = new Map(readTree(dir).map((f) => [f.path, f]));
  const missing = [];
  const changed = [];
  for (const [rel, { content, mode }] of outputs) {
    const disk = onDisk.get(rel);
    if (!disk) missing.push(rel);
    else if (!Buffer.from(content).equals(disk.content) || (mode !== undefined && process.platform !== 'win32' && (mode & 0o111) !== (disk.mode & 0o111))) changed.push(rel);
  }
  const extra = [...onDisk.keys()].filter((rel) => !outputs.has(rel));
  return { missing: missing.sort(), extra: extra.sort(), changed: changed.sort() };
}

const MARKER = path.join('.antigravity-plugin', 'plugin.json');

/**
 * The output dir is deleted recursively, so refuse anything that is not a previous output of this generator:
 * the repo root, an ancestor of it, or an existing non-empty dir without our manifest.
 */
function assertSafeOutDir(dir, root) {
  const target = path.resolve(dir);
  const repo = path.resolve(root);
  if (target === repo || repo.startsWith(target + path.sep) || path.parse(target).root === target) {
    throw new Error(`refusing to write into ${target}: it is the repo root or an ancestor of it`);
  }
  if (!fs.existsSync(target)) return;
  if (!fs.statSync(target).isDirectory()) throw new Error(`refusing to replace ${target}: it is not a directory`);
  if (fs.readdirSync(target).length === 0) return;
  let ours = false;
  try { ours = JSON.parse(fs.readFileSync(path.join(target, MARKER), 'utf8')).name === 'rig'; } catch { /* not ours */ }
  if (!ours) throw new Error(`refusing to delete ${target}: it is not a previous Antigravity plugin output (no ${MARKER} with name "rig")`);
}

function writeOutputs(outputs, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [rel, { content, mode }] of outputs) {
    const dest = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
    if (mode) fs.chmodSync(dest, mode);
  }
}

/**
 * Build and write. `root` is the repo root; `outDir` defaults to <root>/antigravity/rig.
 * @returns {{ stats: object }}
 */
function generate({ root = ROOT, outDir = path.join(root, 'antigravity', 'rig'), listFiles } = {}) {
  assertSafeOutDir(outDir, root);
  const { outputs, stats } = buildOutputs({ root, listFiles });
  assertNoLeftovers(toEntries(outputs), root, listFiles);
  writeOutputs(outputs, outDir);
  return { stats };
}

/** Leftover check of the files on disk in `outDir` (default antigravity/rig); throws on a leftover. */
function checkLeftoversOnDisk({ root = ROOT, outDir = path.join(root, 'antigravity', 'rig'), listFiles } = {}) {
  const tree = fs.existsSync(outDir) ? readTree(outDir) : [];
  if (tree.length === 0) throw new Error(`${outDir} is missing or empty: nothing to check`);
  const { outputs } = buildOutputs({ root, listFiles });
  assertNoLeftovers(tree.map((f) => ({ ...f, verbatim: Boolean(outputs.get(f.path)?.verbatim) })), root, listFiles);
}

/** @returns {{ stale: boolean, report: string[] }} */
function checkFresh({ root = ROOT, outDir = path.join(root, 'antigravity', 'rig'), listFiles } = {}) {
  const { outputs } = buildOutputs({ root, listFiles });
  assertNoLeftovers(toEntries(outputs), root, listFiles);
  const { missing, extra, changed } = compareWithDisk(outputs, outDir);
  const report = [...missing.map((p) => `missing  ${p}`), ...extra.map((p) => `stale    ${p}`), ...changed.map((p) => `changed  ${p}`)];
  return { stale: report.length > 0, report };
}

function main(argv) {
  const outIdx = argv.indexOf('--out');
  const outDir = outIdx !== -1 && argv[outIdx + 1] ? path.resolve(argv[outIdx + 1]) : DEFAULT_OUT;
  if (argv.includes('--check-leftovers')) {
    // Verbatim files (hooks, adapter scripts) are known from a build; the files on disk in --out are what gets checked.
    checkLeftoversOnDisk({ outDir });
    console.log(`OK no Claude Code-only leftovers in ${path.relative(ROOT, outDir) || outDir}/`);
  } else if (argv.includes('--check')) {
    const { stale, report } = checkFresh({ outDir });
    if (stale) {
      console.error(`x antigravity/rig/ is out of date (${report.length} file(s)). Run 'node scripts/sync-antigravity-plugin.cjs' and commit the result.\n${report.slice(0, 40).join('\n')}`);
      return 1;
    }
    console.log('OK antigravity/rig/ matches plugins/rig/');
  } else {
    const { stats } = generate({ outDir });
    console.log(`OK ${path.relative(ROOT, outDir) || '.'}: ${stats.skills} skills, ${stats.agents} agents, ${stats.files} files, version ${stats.version}`);
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`x Sync failed: ${err.message}`);
    process.exitCode = 1;
  }
}

module.exports = { assertSafeOutDir, generate, checkFresh, checkLeftoversOnDisk, compareWithDisk, assertNoLeftovers };
