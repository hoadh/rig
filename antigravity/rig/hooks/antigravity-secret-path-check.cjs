/**
 * antigravity-secret-path-check.cjs - ask-before-read for secret files through Antigravity's native read tools.
 *
 * The Rig Bash guard only sees shell commands. Under Claude Code, `permissions.ask Read(...)` covers the Read
 * tool; Antigravity has no such setting, so this matcher applies the same glob set (the Bash rule's
 * loadAllSecretGlobs: built-in list plus the Read ask entries of the user's and project's settings) to the
 * paths a read tool is given. New matcher on purpose: the rule module does not export its path test.
 * Decision is ask only (the adapter turns it into force_ask); templates (.env.example) never match.
 */
const os = require('os');
const path = require('path');

const TEMPLATE_SUFFIX = /\.(example|sample|template)$/i;
let cache = null;

/** Glob (`**`, `*`, `?`) over forward-slash absolute paths -> anchored case-insensitive RegExp. */
function globToRegex(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { out += '(?:.*/)?'; i += 2; } else { out += '.*'; i += 1; }
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 'i');
}

function matchers() {
  if (!cache) {
    const { loadAllSecretGlobs } = require('./lib/bash-secret-file-read-rule.cjs');
    cache = loadAllSecretGlobs().map(globToRegex);
  }
  return cache;
}

/** Absolute forward-slash form of a tool path; `~` and a leading $HOME are resolved, relative paths use `cwd`. */
function resolvePath(raw, cwd) {
  const home = os.homedir();
  const expanded = raw.replace(/^file:\/\//, '').replace(/^(?:~|\$HOME|\$\{HOME\})(?=[/\\]|$)/, home);
  const abs = path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded);
  return path.normalize(abs).replace(/\\/g, '/');
}

// Representative secret basenames for glob arguments (`.env*`, `*.pem`); data extensions (json, yaml) are left out
// so `*.json` never asks.
const SAMPLE_NAMES = ['.env', '.env.local', '.env.production', '.env.development', 'server.pem', 'server.key', 'id_rsa', 'id_ed25519'];
const MAX_RESOLVED = 4096;
const ask = (what) => ({ decision: 'ask', reason: `Reading ${what} may expose secrets. Confirm that this file should be read.` });

/** True when a glob (grep_search Includes) is a literal secret name or could match a sample secret name. */
function includeHitsSecret(include, searchPath, cwd) {
  const base = path.posix.basename(include.replace(/\\/g, '/'));
  if (!/[*?]/.test(base)) {
    const resolved = resolvePath(path.posix.join(searchPath || cwd, include), cwd);
    return !TEMPLATE_SUFFIX.test(base) && matchers().some((re) => re.test(resolved));
  }
  if (!base.replace(/[*?]/g, '')) return false; // `*` alone matches everything: not a secret signal
  const re = globToRegex(base);
  return SAMPLE_NAMES.some((name) => re.test(name));
}

/**
 * @param {string[]} paths path arguments of the read tool
 * @param {string} cwd workspace, base for relative paths
 * @param {string[]} [includes] grep_search include globs, matched against secret names under the search path
 * @returns {{decision: 'ask', reason: string} | null}
 */
function checkSecretPaths(paths, cwd, includes = []) {
  for (const raw of paths) {
    const resolved = resolvePath(raw, cwd); // normalise first: `./` padding must not push a path past a length limit
    if (resolved.length > MAX_RESOLVED) return ask('a path too long to check');
    if (TEMPLATE_SUFFIX.test(path.posix.basename(resolved))) continue;
    if (matchers().some((re) => re.test(resolved))) return ask(path.posix.basename(resolved));
  }
  const searchPath = paths.length > 0 ? resolvePath(paths[0], cwd) : cwd;
  for (const include of includes) if (include.length <= 1024 && includeHitsSecret(include, searchPath, cwd)) return ask(include);
  return null;
}

module.exports = { checkSecretPaths, globToRegex };
