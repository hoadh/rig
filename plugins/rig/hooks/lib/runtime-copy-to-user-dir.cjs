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
 *   - The copy is STAGED in a sibling dir (`runtime.tmp-<pid>`, VERSION written last) and swapped in by renaming:
 *     the old dir is renamed aside, the staged one renamed into place, then the old one removed. A running worker
 *     never has files deleted under it; if the old dir cannot be removed (files in use, Windows) it is left and
 *     swept on a later run. Readers (statusline, worker) fail closed without VERSION.
 *   - A runtime whose VERSION is semver-greater is never overwritten (an older plugin session, a dev checkout or
 *     a pinned project must not downgrade the shared copy) unless `force`.
 *   - The old dir is replaced whole, so a stale file or a planted symlink never survives or gets followed.
 *   - Symlinks in the source are refused; the destination dir must not resolve outside `~/.claude/rig`.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { acquireLock, releaseLock, sleepSync } = require('./dir-lock-with-owner-token.cjs');

// [source relative to the plugin root, destination relative to the runtime dir]; directories are copied whole
const RUNTIME_ENTRIES = [
  ['statusline.cjs', 'statusline.cjs'],
  ...['colors', 'config-counter', 'git-info-cache', 'plugin-data-dir', 'rig-config-utils',
    'statusline-items', 'statusline-segment-renderers', 'statusline-text-formatters', 'transcript-parser']
    .map((name) => [`hooks/lib/${name}.cjs`, `hooks/lib/${name}.cjs`]),
  ['skills/remote/scripts/worker.cjs', 'remote/worker.cjs'],
  ['skills/remote/scripts/worker-run-entry.cjs', 'remote/worker-run-entry.cjs'],
  ['skills/remote/scripts/worker-commands', 'remote/worker-commands'],
  ['skills/remote/scripts/lib', 'remote/lib'],
];
const VERSION_FILE = 'VERSION';
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/;
const LOCK_STALE_MS = 60 * 1000;
const LEFTOVER_MAX_AGE_MS = 10 * 60 * 1000;
const RENAME_RETRIES = 5;

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

/** Semver precedence: negative when a < b, 0 when equal, positive when a > b (prerelease sorts below its release). */
function compareSemver(a, b) {
  const parse = (v) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(v);
    return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
  if (!x.pre || !y.pre) return x.pre ? -1 : y.pre ? 1 : 0;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn && Number(p) !== Number(q)) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    if (!pn && p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/** rename with a few retries: on Windows a dir that is some process's cwd or has open files refuses to move. */
function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      if (attempt >= RENAME_RETRIES || !['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'].includes(err.code)) throw err;
      sleepSync(100 * (attempt + 1));
    }
  }
}

/** Remove aside/staging dirs a crashed or blocked earlier copy left behind (old enough not to be in use by a live copy). */
function sweepLeftovers(rigDir) {
  for (const name of fs.readdirSync(rigDir)) {
    if (!/^runtime\.(tmp|old|lock\.stale)-/.test(name)) continue;
    const full = path.join(rigDir, name);
    try {
      if (Date.now() - fs.statSync(full).mtimeMs > LEFTOVER_MAX_AGE_MS) fs.rmSync(full, { recursive: true, force: true });
    } catch { /* still in use or already gone: a later run retries */ }
  }
}

/**
 * Copy the runtime files when the stamped version differs (or the copy is incomplete).
 * @param {{pluginRoot: string, home?: string, force?: boolean}} opts
 * @returns {{status: 'copied'|'current'|'busy'|'newer', version: string, dir: string}}
 *   `newer`: the installed runtime has a greater version and is kept (`version` is then the installed one)
 * @throws on a missing/invalid plugin.json, an escaping symlink, or an unwritable destination (callers fail open)
 */
function copyRuntime({ pluginRoot, home = os.homedir(), force = false }) {
  const version = readPluginVersion(pluginRoot);
  const realRoot = fs.realpathSync(pluginRoot);
  const files = expandEntries(pluginRoot, realRoot);
  const rigDir = rigDirFor(home);
  const dir = runtimeDirFor(home);
  fs.mkdirSync(rigDir, { recursive: true });
  const realRig = fs.realpathSync(rigDir);
  if (fs.existsSync(dir) || isDanglingLink(dir)) {
    const realDir = fs.realpathSync(dir);
    if (!isInside(realRig, realDir)) throw new Error(`runtime dir ${dir} resolves outside ${rigDir}`);
  }
  const installed = readRuntimeVersion(dir);
  if (!force && installed && compareSemver(installed, version) > 0) return { status: 'newer', version: installed, dir };
  if (!force && installed === version && isComplete(dir, files.map(([, rel]) => rel))) return { status: 'current', version, dir };

  const lockDir = path.join(realRig, 'runtime.lock');
  const token = acquireLock(lockDir, LOCK_STALE_MS);
  if (!token) return { status: 'busy', version, dir };
  const staging = path.join(realRig, `runtime.tmp-${process.pid}`);
  const aside = path.join(realRig, `runtime.old-${process.pid}`);
  try {
    sweepLeftovers(realRig);
    // Re-check under the lock: another session may have finished the same or a newer copy meanwhile
    const now = readRuntimeVersion(dir);
    if (!force && now && (compareSemver(now, version) > 0 || (now === version && isComplete(dir, files.map(([, rel]) => rel))))) {
      return { status: now === version ? 'current' : 'newer', version: now, dir };
    }
    fs.rmSync(staging, { recursive: true, force: true });
    for (const [src, rel] of files) {
      const dest = path.join(staging, ...rel.split('/'));
      if (!isInside(staging, dest)) throw new Error(`runtime destination escapes the runtime dir: ${rel}`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, fs.readFileSync(src));
    }
    const versionTmp = path.join(staging, `${VERSION_FILE}.tmp`);
    fs.writeFileSync(versionTmp, `${version}\n`);
    fs.renameSync(versionTmp, path.join(staging, VERSION_FILE)); // last: marks the copy complete
    // Swap: old dir aside first (works for Windows too), then the staged dir into place
    fs.rmSync(aside, { recursive: true, force: true });
    const hadOld = fs.existsSync(dir) || isDanglingLink(dir);
    if (hadOld) renameWithRetry(dir, aside);
    try {
      renameWithRetry(staging, dir);
    } catch (err) {
      if (hadOld) fs.renameSync(aside, dir); // put the previous runtime back
      throw err;
    }
    try { fs.rmSync(aside, { recursive: true, force: true }); } catch { /* files in use: swept by a later run */ }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    releaseLock(lockDir, token);
  }
  return { status: 'copied', version, dir };
}

function isDanglingLink(p) {
  try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; }
}

module.exports = { RUNTIME_ENTRIES, copyRuntime, readRuntimeVersion, runtimeDirFor, rigDirFor, compareSemver, VERSION_FILE };
