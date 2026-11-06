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
 * version differs. Exit 1 = bump missing, exit 2 = could not compare (missing base ref, bad JSON).
 */
const { execFileSync } = require('child_process');
const path = require('path');

const PLUGIN_DIR = 'plugins/rig';
const MANIFEST = `${PLUGIN_DIR}/.claude-plugin/plugin.json`;

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
 * @returns {{ ok: boolean, reason: string }}
 */
function decide({ changedFiles, baseVersion, headVersion }) {
  const changed = changedFiles.filter((f) => f.startsWith(`${PLUGIN_DIR}/`));
  if (changed.length === 0) return { ok: true, reason: `no changes under ${PLUGIN_DIR}/` };
  if (headVersion === null) return { ok: false, reason: `${MANIFEST} has no readable "version"` };
  if (baseVersion === null) return { ok: true, reason: `first plugin.json on this base (version ${headVersion})` };
  if (baseVersion !== headVersion) return { ok: true, reason: `version bumped ${baseVersion} -> ${headVersion}` };
  return {
    ok: false,
    reason: `${changed.length} file(s) under ${PLUGIN_DIR}/ changed but ${MANIFEST} still says ${headVersion}; bump the version.\n  ${changed.slice(0, 10).join('\n  ')}${changed.length > 10 ? `\n  ... +${changed.length - 10} more` : ''}`,
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
  return decide({ changedFiles, baseVersion, headVersion });
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

module.exports = { decide, parseVersion, check };
