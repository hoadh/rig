'use strict';
/**
 * Runtime copy: the few Rig files that must run OUTSIDE a Claude Code plugin session are copied to a fixed
 * user-level path, `~/.claude/rig/runtime/`:
 *   - the remote worker (`node ~/.claude/rig/runtime/remote/worker.cjs`, started by plain ssh, no plugin env)
 *   - statusline.cjs and its libs (a settings `statusLine` command, also no plugin env)
 * The plugin cache path changes with every version, so nothing may point into it; nothing here scans the plugin
 * registry or cache either. The only source is the plugin root of the hook that calls this (session-init).
 *
 * Safety:
 *   - A fixed file list, so no path comes from data; destinations are checked to stay under the runtime dir.
 *   - `VERSION` is written LAST via atomic rename and removed FIRST: an interrupted copy has no VERSION, and
 *     readers (statusline, worker) fail closed without it.
 *   - Managed entries are deleted before copying, so a stale file or a planted symlink never survives or gets followed.
 *   - Symlinks in the source are refused; the destination dir must not resolve outside `~/.claude/rig`.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

// [source relative to the plugin root, destination relative to the runtime dir]; directories are copied whole
const RUNTIME_ENTRIES = [
  ['statusline.cjs', 'statusline.cjs'],
  ...['colors', 'config-counter', 'git-info-cache', 'plugin-data-dir', 'rig-config-utils',
    'statusline-segment-renderers', 'statusline-text-formatters', 'transcript-parser']
    .map((name) => [`hooks/lib/${name}.cjs`, `hooks/lib/${name}.cjs`]),
  ['skills/remote/scripts/worker.cjs', 'remote/worker.cjs'],
  ['skills/remote/scripts/worker-run-entry.cjs', 'remote/worker-run-entry.cjs'],
  ['skills/remote/scripts/worker-commands', 'remote/worker-commands'],
  ['skills/remote/scripts/lib', 'remote/lib'],
];
// Top-level destinations owned by the copy (wiped before each copy).
const MANAGED_TOP_LEVEL = ['statusline.cjs', 'hooks', 'remote'];
const VERSION_FILE = 'VERSION';
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/;
const LOCK_STALE_MS = 60 * 1000;

const rigDirFor = (home = os.homedir()) => path.join(home, '.claude', 'rig');
const runtimeDirFor = (home = os.homedir()) => path.join(rigDirFor(home), 'runtime');

/** The stamped version of a runtime dir, or null when VERSION is missing/invalid (= incomplete copy, readers fail closed). */
function readRuntimeVersion(runtimeDir) {
  try {
    const v = fs.readFileSync(path.join(runtimeDir, VERSION_FILE), 'utf8').trim();
    return VERSION_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** True when `child` is strictly inside `parent` (both absolute and resolved). */
const isInside = (parent, child) => child.startsWith(parent + path.sep);

function readPluginVersion(pluginRoot) {
  const v = JSON.parse(fs.readFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  if (typeof v !== 'string' || !VERSION_RE.test(v)) throw new Error('plugin.json has no valid version');
  return v;
}

/** Every [absolute source file, relative destination path] of the fixed list; directories are walked, symlinks refused. */
function expandEntries(pluginRoot, realRoot) {
  const files = [];
  const add = (src, rel) => {
    const st = fs.lstatSync(src);
    if (st.isSymbolicLink()) throw new Error(`refusing symlink in the runtime source: ${src}`);
    const real = fs.realpathSync(src);
    if (real !== realRoot && !isInside(realRoot, real)) throw new Error(`runtime source escapes the plugin root: ${src}`);
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(src).sort()) add(path.join(src, name), `${rel}/${name}`);
    } else if (st.isFile()) {
      files.push([src, rel]);
    }
  };
  for (const [srcRel, destRel] of RUNTIME_ENTRIES) add(path.join(pluginRoot, ...srcRel.split('/')), destRel);
  return files;
}

function isComplete(runtimeDir, expectedRels) {
  return expectedRels.every((rel) => fs.existsSync(path.join(runtimeDir, ...rel.split('/'))));
}

function acquireLock(lockDir) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.mkdirSync(lockDir);
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        if (Date.now() - fs.statSync(lockDir).mtimeMs < LOCK_STALE_MS) return false;
        fs.rmSync(lockDir, { recursive: true, force: true }); // stale lock of a crashed copy
      } catch { /* raced with the owner releasing it: retry */ }
    }
  }
  return false;
}

/**
 * Copy the runtime files when the stamped version differs (or the copy is incomplete).
 * @param {{pluginRoot: string, home?: string, force?: boolean}} opts
 * @returns {{status: 'copied'|'current'|'busy', version: string, dir: string}}
 * @throws on a missing/invalid plugin.json, an escaping symlink, or an unwritable destination (callers fail open)
 */
function copyRuntime({ pluginRoot, home = os.homedir(), force = false }) {
  const version = readPluginVersion(pluginRoot);
  const realRoot = fs.realpathSync(pluginRoot);
  const files = expandEntries(pluginRoot, realRoot);
  const rigDir = rigDirFor(home);
  const dir = runtimeDirFor(home);
  fs.mkdirSync(dir, { recursive: true });
  const realRig = fs.realpathSync(rigDir);
  const realDir = fs.realpathSync(dir);
  if (!isInside(realRig, realDir)) throw new Error(`runtime dir ${dir} resolves outside ${rigDir}`);

  if (!force && readRuntimeVersion(dir) === version && isComplete(dir, files.map(([, rel]) => rel))) return { status: 'current', version, dir };

  const lockDir = path.join(realRig, 'runtime.lock');
  if (!acquireLock(lockDir)) return { status: 'busy', version, dir };
  try {
    fs.rmSync(path.join(realDir, VERSION_FILE), { force: true }); // invalidate first: no VERSION = readers fail closed
    for (const top of MANAGED_TOP_LEVEL) fs.rmSync(path.join(realDir, top), { recursive: true, force: true });
    for (const [src, rel] of files) {
      const dest = path.join(realDir, ...rel.split('/'));
      if (!isInside(realDir, dest)) throw new Error(`runtime destination escapes the runtime dir: ${rel}`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const tmp = `${dest}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, fs.readFileSync(src));
      fs.renameSync(tmp, dest);
    }
    const versionTmp = path.join(realDir, `${VERSION_FILE}.tmp-${process.pid}`);
    fs.writeFileSync(versionTmp, `${version}\n`);
    fs.renameSync(versionTmp, path.join(realDir, VERSION_FILE)); // last: marks the copy complete
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
  return { status: 'copied', version, dir };
}

module.exports = { RUNTIME_ENTRIES, copyRuntime, readRuntimeVersion, runtimeDirFor, rigDirFor, VERSION_FILE };
