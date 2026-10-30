'use strict';
/**
 * Which user-level git config files feed the known-good baseline hash (review M2/M3, round 4 M1/M2).
 *  - Fixed set, independent of whether XDG_CONFIG_HOME is set in this process: ~/.gitconfig,
 *    ~/.config/git/config and $XDG_CONFIG_HOME/git/config when set (non-empty, as in git) and different.
 *  - Include closure: found TEXTUALLY, not via `git config --list`, so it is independent of repo state and of
 *    the includeIf condition. Every `path` key in an `[include]` / `[includeIf "..."]` section of a reached file
 *    is followed (`~/` -> HOME, relative -> directory of the including file, as git does), recursively, deduped
 *    by resolved path (cycle-safe). Over-approximating is fine: more files hashed, never fewer. This covers
 *    `hasconfig:` targets (not visible in a --global listing) and `onbranch:` ones (HEAD-dependent in git).
 *  - Parsing follows git's own grammar (git-config-include-path-tokenizer.cjs: quoting, escapes, continuation
 *    only inside values, comments), so a comment/continuation trick cannot hide an include from us.
 *  - Targets are resolved like the kernel: plain string join (no lexical `..` collapsing), then symlinks are
 *    resolved (physicalPath); the real path is what is hashed/deduped. `~user/` and `%(prefix)/` paths cannot be
 *    resolved here and contribute a distinct `unresolvable:<raw>` marker.
 *  - Files are hashed in full (configs are small). More than MAX_INCLUDED extra files = non-quarantining
 *    RunFailure('prepare'), never a marker an edit could hide behind.
 * Residual same-user risks NOT covered (documented in SKILL.md): ~/.ssh/config, shell rc files, PATH shims.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RunFailure } = require('./run-directory.cjs');
const { includePathsOfText } = require('./git-config-include-path-tokenizer.cjs');

const MAX_INCLUDED = 64;

/**
 * HOME exactly as git reads it: `env.HOME`, else os.homedir(). NO MSYS conversion: native git for Windows does not
 * translate `HOME=/c/Users/x`, it reads the drive-relative `\c\Users\x\.gitconfig`, so that is the file to hash.
 */
function homeDir(env) {
  return env.HOME || os.homedir();
}

/** Fixed user-level config files (deduped, stable order). Reads HOME first: tests redirect it. */
function fixedGlobalConfigFiles(env = process.env) {
  const home = homeDir(env);
  const list = [path.join(home, '.gitconfig'), path.join(home, '.config', 'git', 'config')];
  if (env.XDG_CONFIG_HOME) list.push(path.join(env.XDG_CONFIG_HOME, 'git', 'config')); // "" = unset, like git
  return [...new Set(list)];
}

/**
 * Include target as git/kernel see it: `~/`, absolute, else relative to the including file's directory, joined as a
 * plain string (NO lexical `..` normalization - the kernel resolves `link/..` physically).
 */
function resolveIncludePath(raw, fromFile, home) {
  if (/^~[^/\\]/.test(raw) || raw.startsWith('%(')) return { marker: `unresolvable:${raw}` };
  if (raw === '~' || raw.startsWith('~/')) return { file: home + raw.slice(1) };
  if (path.isAbsolute(raw)) return { file: raw };
  return { file: `${path.dirname(fromFile)}/${raw}` };
}

/** Symlink-resolved path with kernel `..` semantics; for a missing tail, the longest existing prefix + remainder. */
function physicalPath(p) {
  const parts = p.split('/');
  for (let k = parts.length; k > 0; k--) {
    const prefix = parts.slice(0, k).join('/') || '/';
    try { return path.join(fs.realpathSync.native(prefix), ...parts.slice(k)); } catch { /* shorten the prefix */ }
  }
  return path.resolve(p);
}

/** Stable marker of one file + its parsed include targets. */
function readConfigFile(full) {
  let buf;
  try { buf = fs.readFileSync(full); } catch (e) { return { marker: e && (e.code === 'ENOENT' || e.code === 'ENOTDIR') ? 'missing' : `unreadable:${e && e.code}`, raws: [] }; }
  return { marker: `present\0${buf.toString('latin1')}`, raws: includePathsOfText(buf.toString('utf8')) };
}

/**
 * Ordered [label, marker] pairs to feed the hash: fixed files first, then the reached include targets (sorted).
 * @returns {Array<[string,string]>}
 * @throws {RunFailure} 'prepare' when more than MAX_INCLUDED extra files are reached
 */
function globalConfigHashParts(repo, env = process.env) { // eslint-disable-line no-unused-vars -- repo kept for caller compatibility
  const home = homeDir(env);
  const fixed = fixedGlobalConfigFiles(env);
  const seen = new Set(fixed.map(physicalPath)); // dedupe by physical path
  const extra = new Map(); // path -> marker
  const markers = new Set();
  const queue = fixed.map((f) => ({ f, real: f, isFixed: true }));
  const fixedParts = [];
  while (queue.length) {
    const { f, real, isFixed } = queue.shift();
    const { marker, raws } = readConfigFile(real);
    if (isFixed) fixedParts.push(marker); else extra.set(real, marker);
    if (extra.size > MAX_INCLUDED) {
      throw new RunFailure('prepare', `global git config reaches more than ${MAX_INCLUDED} included files`, { hint: 'trim the include/includeIf chain of ~/.gitconfig (or its XDG equivalent), then re-run `worker.cjs baseline`' });
    }
    for (const raw of raws) {
      const r = resolveIncludePath(raw, f, home);
      if (r.marker) markers.add(r.marker);
      else {
        const real = physicalPath(r.file);
        if (!seen.has(real)) { seen.add(real); queue.push({ f: r.file, real, isFixed: false }); } // f: as written, for nested relative includes
      }
    }
  }
  const parts = fixedParts.map((m, i) => [`global${i}`, m]);
  [...extra.keys()].sort().forEach((f, i) => parts.push([`include${i}\0${f}`, extra.get(f)]));
  [...markers].sort().forEach((m, i) => parts.push([`unresolved${i}`, m]));
  return parts;
}

module.exports = { fixedGlobalConfigFiles, globalConfigHashParts, includePathsOfText, MAX_INCLUDED };
