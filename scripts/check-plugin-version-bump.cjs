#!/usr/bin/env node
/**
 * CI gate: a change under plugins/rig/ must come with a version bump in
 * plugins/rig/.claude-plugin/plugin.json. Claude Code caches a plugin by version, so shipped
 * changes without a new version never reach installed users.
 *
 *   node scripts/check-plugin-version-bump.cjs [--base origin/main]
 *
 * Compares HEAD with the merge base of <base> (default origin/main). Passes when nothing under
 * plugins/rig/ changed, when plugin.json did not exist on the base yet (first release), or when the
 * version is semver-greater than the base's. A marketplace.json plugin entry that carries a `version` must
 * equal plugin.json's. Exit 1 = bump missing, exit 2 = could not compare (missing base ref, bad JSON).
 */
const { execFileSync } = require('child_process');
const path = require('path');

const PLUGIN_DIR = 'plugins/rig';
const MANIFEST = `${PLUGIN_DIR}/.claude-plugin/plugin.json`;
const MARKETPLACE = '.claude-plugin/marketplace.json';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Parses `x.y.z[-pre][+build]`; null when it is not strict semver (so whitespace or `v` prefixes fail). */
function parseSemver(v) {
  const m = SEMVER.exec(v);
  return m ? { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] } : null;
}

/** semver.org precedence: -1, 0, 1, or null when either side is not valid semver. */
function compareSemver(a, b) {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] < y.core[i] ? -1 : 1;
  if (x.pre.length === 0 || y.pre.length === 0) return x.pre.length === y.pre.length ? 0 : x.pre.length === 0 ? 1 : -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) < Number(q) ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}

/** Version string from a plugin.json text; null when missing or unparsable. */
function parseVersion(text) {
  try {
    const v = JSON.parse(text).version;
    return typeof v === 'string' && v !== '' ? v : null;
  } catch {
    return null;
  }
}

/**
 * Pure decision. `baseVersion` is null when the base has no manifest (first introduction).
 * `marketplaceVersion` is the `version` of the marketplace entry for the plugin, undefined when it has none.
 * @returns {{ ok: boolean, reason: string }}
 */
function decide({ changedFiles, baseVersion, headVersion, marketplaceVersion }) {
  if (marketplaceVersion !== undefined && headVersion !== null && marketplaceVersion !== headVersion) {
    return { ok: false, reason: `${MARKETPLACE} lists version ${marketplaceVersion} but ${MANIFEST} says ${headVersion}; keep them equal (or drop the marketplace version)` };
  }
  const changed = changedFiles.filter((f) => f.startsWith(`${PLUGIN_DIR}/`));
  if (changed.length === 0) return { ok: true, reason: `no changes under ${PLUGIN_DIR}/` };
  if (headVersion === null) return { ok: false, reason: `${MANIFEST} has no readable "version"` };
  if (baseVersion === null) return { ok: true, reason: `first plugin.json on this base (version ${headVersion})` };
  const cmp = compareSemver(headVersion, baseVersion);
  if (cmp === null) return { ok: false, reason: `versions must be strict semver (base "${baseVersion}", head "${headVersion}")` };
  if (cmp > 0) return { ok: true, reason: `version bumped ${baseVersion} -> ${headVersion}` };
  return {
    ok: false,
    reason: `${changed.length} file(s) under ${PLUGIN_DIR}/ changed but ${MANIFEST} is ${headVersion} (base ${baseVersion}); the version must be greater than the base's.\n  ${changed.slice(0, 10).join('\n  ')}${changed.length > 10 ? `\n  ... +${changed.length - 10} more` : ''}`,
  };
}

function check(cwd, base) {
  const mergeBase = git(cwd, ['merge-base', base, 'HEAD']).trim();
  const changedFiles = git(cwd, ['diff', '--name-only', mergeBase, 'HEAD', '--', PLUGIN_DIR]).split('\n').filter(Boolean);
  // A missing manifest (absent on the base, or deleted on HEAD) reads as null.
  const versionAt = (rev) => {
    try {
      return parseVersion(git(cwd, ['show', `${rev}:${MANIFEST}`]));
    } catch {
      return null;
    }
  };
  const baseVersion = versionAt(mergeBase);
  const headVersion = versionAt('HEAD');
  let marketplaceVersion;
  try {
    const entry = (JSON.parse(git(cwd, ['show', `HEAD:${MARKETPLACE}`])).plugins || []).find((p) => p && p.name === 'rig');
    if (entry && typeof entry.version === 'string') marketplaceVersion = entry.version;
  } catch {
    marketplaceVersion = undefined; // no marketplace manifest or not JSON: validate/CI report that
  }
  return decide({ changedFiles, baseVersion, headVersion, marketplaceVersion });
}

function main(argv) {
  const i = argv.indexOf('--base');
  const base = i !== -1 && argv[i + 1] ? argv[i + 1] : 'origin/main';
  let result;
  try {
    result = check(path.resolve(__dirname, '..'), base);
  } catch (err) {
    console.error(`x Cannot compare with ${base} (is it fetched? CI needs fetch-depth: 0): ${String(err.stderr || err.message).split('\n')[0]}`);
    return 2;
  }
  console.log(`${result.ok ? 'OK' : 'x'} plugin version check: ${result.reason}`);
  return result.ok ? 0 : 1;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { decide, parseVersion, compareSemver, check };
