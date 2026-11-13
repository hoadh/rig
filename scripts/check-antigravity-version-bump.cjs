#!/usr/bin/env node
/**
 * CI gate: a change to the Antigravity plugin must come with a new Antigravity plugin version.
 *
 *   node scripts/check-antigravity-version-bump.cjs [--base origin/main]
 *
 * "Change" = any file under antigravity/rig/ or scripts/antigravity/ that differs from the merge base, except tests
 * (`*.test.cjs`) and their `__fixtures__/`, which never ship. The version is the `version` of
 * antigravity/rig/.antigravity-plugin/plugin.json, `<rig version>-agy.<n>`. It counts as bumped when the Rig version is
 * greater, or the Rig version is equal and `n` is greater. Passes when nothing changed, or when the base has no
 * Antigravity plugin yet (first release). Exit 1 = bump missing, exit 2 = could not compare.
 */
const { execFileSync } = require('child_process');
const path = require('path');
const { compareSemver } = require('./check-plugin-version-bump.cjs');
const { parseAgyVersion } = require('./antigravity/plugin-manifest-writer.cjs');

const MANIFEST = 'antigravity/rig/.antigravity-plugin/plugin.json';
const WATCHED = ['antigravity/rig', 'scripts/antigravity'];
const SHIPS = (file) => !/\.test\.cjs$/.test(file) && !/(^|\/)__fixtures__\//.test(file);

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });

/** `{ rig, n }` of a plugin.json text; null when missing or not `<semver>-agy.<n>`. */
function parseManifestVersion(text) {
  try {
    return parseAgyVersion(JSON.parse(text).version);
  } catch {
    return null;
  }
}

/**
 * Pure decision. `baseVersion` is null when the base has no Antigravity manifest (first introduction).
 * @param {{ changedFiles: string[], baseVersion: {rig: string, n: number}|null, headVersion: {rig: string, n: number}|null }} input
 * @returns {{ ok: boolean, reason: string }}
 */
function decide({ changedFiles, baseVersion, headVersion }) {
  const changed = changedFiles.filter((f) => WATCHED.some((w) => f.startsWith(`${w}/`)) && SHIPS(f));
  if (changed.length === 0) return { ok: true, reason: 'no Antigravity plugin changes' };
  if (headVersion === null) return { ok: false, reason: `${MANIFEST} has no readable "<rig version>-agy.<n>" version` };
  if (baseVersion === null) return { ok: true, reason: `first Antigravity plugin on this base (${headVersion.rig}-agy.${headVersion.n})` };
  const cmp = compareSemver(headVersion.rig, baseVersion.rig);
  const label = (v) => `${v.rig}-agy.${v.n}`;
  if (cmp === null) return { ok: false, reason: `Rig versions must be strict semver (base ${label(baseVersion)}, head ${label(headVersion)})` };
  if (cmp > 0 || (cmp === 0 && headVersion.n > baseVersion.n)) return { ok: true, reason: `version bumped ${label(baseVersion)} -> ${label(headVersion)}` };
  return {
    ok: false,
    reason: `${changed.length} file(s) changed under ${WATCHED.join(' / ')} but the version is ${label(headVersion)} (base ${label(baseVersion)}); raise "n" in scripts/antigravity/agy-version.json (or the Rig version) and run node scripts/sync-antigravity-plugin.cjs.\n  ${changed.slice(0, 10).join('\n  ')}${changed.length > 10 ? `\n  ... +${changed.length - 10} more` : ''}`,
  };
}

function check(cwd, base) {
  const mergeBase = git(cwd, ['merge-base', base, 'HEAD']).trim();
  const changedFiles = git(cwd, ['diff', '--name-only', mergeBase, 'HEAD', '--', ...WATCHED]).split('\n').filter(Boolean);
  const versionAt = (rev) => {
    try {
      return parseManifestVersion(git(cwd, ['show', `${rev}:${MANIFEST}`]));
    } catch {
      return null; // no manifest at that revision
    }
  };
  return decide({ changedFiles, baseVersion: versionAt(mergeBase), headVersion: versionAt('HEAD') });
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
  console.log(`${result.ok ? 'OK' : 'x'} antigravity version check: ${result.reason}`);
  return result.ok ? 0 : 1;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { decide, parseManifestVersion, check };
