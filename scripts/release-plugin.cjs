#!/usr/bin/env node
/**
 * Rig plugin release: pins the marketplace entry to a git tag + sha, commits it and creates the annotated tag.
 *
 *   node scripts/release-plugin.cjs [--apply] [--allow-branch] [--skip-tests]
 *   node scripts/release-plugin.cjs --check-ref      (CI: marketplace ref/sha vs the latest v* tag on HEAD)
 *
 * Default is a dry run: every check runs and the plan is printed, nothing is written. `--apply` needs a terminal
 * outside Claude Code (same consent gate as rig-init: CLAUDECODE, Claude Code ancestry, TTY, y/N prompt) and
 * `npm test` must pass (`--skip-tests` is dry-run only). The script never pushes.
 *
 * Checks: clean tree; on `main` (or --allow-branch for betas); plugin.json version is strict semver and greater than
 * the latest v* tag (prerelease-aware); v<version> is not tagged yet; a stable version has a dated CHANGELOG section
 * (`## <version> (YYYY-MM-DD)`, not `(unreleased)`), so the tag never ships stale release notes; antigravity/rig/ matches a
 * fresh build (read-only `sync-antigravity-plugin.cjs --check`; regenerate through the release-prep PR, never here);
 * `npm test` passes.
 *
 * Chicken-and-egg: the marketplace entry must name the commit that holds the release content, but writing the entry
 * is itself a commit. So the content commit is the current HEAD (S): the entry is committed on top of it (S+1) with
 * `ref: v<version>, sha: S`, and the annotated tag points at S, not at S+1. A user installing from the marketplace
 * entry gets exactly S (the tag and the sha agree); S is an ancestor of the branch tip, so `v*` is reachable from main.
 *
 * `main` takes no direct push of an untested commit (ruleset `main-ci-required`), and S+1 is new. On `main` the pin is
 * therefore committed on a new branch `release/v<version>` (the checkout moves there); the user pushes it, opens a pull
 * request, fast-forwards `main` after CI and only then pushes the tag. On another branch (a beta) the pin is committed
 * on that branch as before.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { compareSemver } = require('./check-plugin-version-bump.cjs');

// compareSemver returns null for anything that is not strict semver, so self-comparison doubles as validation.
const isSemver = (v) => typeof v === 'string' && compareSemver(v, v) === 0;

const MANIFEST = 'plugins/rig/.claude-plugin/plugin.json';
const MARKETPLACE = '.claude-plugin/marketplace.json';
const PLUGIN_NAME = 'rig';
const CHANGELOG = 'CHANGELOG.md';

/** Why the CHANGELOG is not ready for a stable `version`, or null. Prereleases have no section of their own. */
function changelogProblem(text, version) {
  if (/-/.test(version)) return null;
  const esc = version.replace(/\./g, '\\.');
  if (new RegExp(`^## ${esc} \\(\\d{4}-\\d{2}-\\d{2}\\)\\s*$`, 'm').test(text)) return null;
  if (new RegExp(`^## ${esc} \\(unreleased\\)`, 'm').test(text)) return `${CHANGELOG}: change "## ${version} (unreleased)" to "## ${version} (<YYYY-MM-DD>)" and update its entries before the release`;
  return `${CHANGELOG} has no "## ${version} (<YYYY-MM-DD>)" section`;
}

/** Highest strict-semver tag name (`v<semver>`) of the list, or null. Non-semver `v*` tags are ignored. */
function latestTag(tags) {
  let best = null;
  for (const t of tags) {
    if (!/^v/.test(t) || !isSemver(t.slice(1))) continue;
    if (best === null || compareSemver(t.slice(1), best.slice(1)) > 0) best = t;
  }
  return best;
}

/** Signed tag when git is configured for signing (user.signingkey or gpg.format), otherwise annotated. */
function tagArgs({ version, sha, signingConfigured }) {
  return ['tag', signingConfigured ? '-s' : '-a', `v${version}`, sha, '-m', `Rig ${version}`];
}

/**
 * The marketplace plugin entry with the release pin applied. Keeps the existing url/path; `git-subdir` because the
 * plugin lives in plugins/rig. The entry carries no `version`: plugin.json at the pinned commit is the only version.
 * A second copy here would have to match plugin.json (CI version gate) while the pin still names the previous
 * release, which is impossible between releases.
 */
function pinnedEntry(entry, { version, sha }) {
  const src = entry.source || {};
  const { version: _dropped, ...rest } = entry;
  return {
    ...rest,
    source: { source: 'git-subdir', url: src.url, path: src.path || 'plugins/rig', ref: `v${version}`, sha },
  };
}

function git(cwd, args, env) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: env || process.env, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${String(r.stderr).trim() || `exit ${r.status}`}`);
  return String(r.stdout).trim();
}

function gitOptional(cwd, args, env) {
  try {
    return git(cwd, args, env);
  } catch {
    return '';
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function rigEntry(marketplace) {
  return (marketplace.plugins || []).find((p) => p && p.name === PLUGIN_NAME);
}

/** Why `--apply` must not run here, or null. No flag skips this; `ancestors` is a test seam (a chain or a function returning one). */
function applyRefusal({ env, stdinIsTTY, stdoutIsTTY, ancestors }) {
  const outside = 'Run this yourself in a terminal: node scripts/release-plugin.cjs --apply';
  if (env.CLAUDECODE) return `--apply tags and commits, so it only runs in a terminal outside Claude Code (CLAUDECODE is set here). ${outside}`;
  // Before the ancestry: a non-TTY run cannot confirm anyway, and must not start the Windows PowerShell query
  if (!stdinIsTTY || !stdoutIsTTY) return `--apply needs an interactive terminal to ask for confirmation (stdin/stdout is not a TTY). ${outside}`;
  const { readAncestry, isClaudeCodeProcess } = require('../plugins/rig/scripts/rig-init/backup-restore-standalone.cjs');
  let chain;
  try {
    chain = typeof ancestors === 'function' ? ancestors() : ancestors || readAncestry();
  } catch (err) {
    return `--apply could not check whether it was started from inside Claude Code (${err.message}), so it refuses. ${outside}`;
  }
  const claude = chain.find(isClaudeCodeProcess);
  if (claude) return `--apply only runs in a terminal outside Claude Code (parent process ${claude.pid} is Claude Code). ${outside}`;
  return null;
}

const ANTIGRAVITY_SYNC = 'scripts/sync-antigravity-plugin.cjs';

/** Why antigravity/rig/ is stale (generator output), or null. Read-only; a repo without the generator is skipped. */
function antigravityStale(cwd) {
  if (!fs.existsSync(path.join(cwd, ANTIGRAVITY_SYNC))) return null;
  const r = spawnSync(process.execPath, [ANTIGRAVITY_SYNC, '--check'], { cwd, encoding: 'utf8' });
  if (r.status === 0) return null;
  return `antigravity/rig/ is stale or invalid; fix it in a release-prep PR (node ${ANTIGRAVITY_SYNC}) before tagging:\n${(r.stderr || r.stdout || r.error?.message || '').trim()}`;
}

function runNpmTest(cwd) {
  const r = spawnSync('npm', ['test'], { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  return r.status === 0;
}

function parseArgs(argv) {
  const opts = { apply: false, allowBranch: false, skipTests: false, checkRef: false };
  for (const a of argv) {
    if (a === '--apply') opts.apply = true;
    else if (a === '--allow-branch') opts.allowBranch = true;
    else if (a === '--skip-tests') opts.skipTests = true;
    else if (a === '--check-ref') opts.checkRef = true;
    else return { error: `unknown argument: ${a}` };
  }
  return { opts };
}

/**
 * Release (or dry-run) in `cwd`. `io` is the test seam; the CLI passes the real process values.
 * @returns {Promise<number>} exit code: 0 ok, 1 a check failed or the user declined, 2 usage/internal error
 */
async function release(opts, io) {
  const { cwd, log, err } = io;
  const env = io.env;
  const failures = [];
  const fail = (m) => failures.push(m);

  if (opts.skipTests && opts.apply) {
    err('x --skip-tests is only allowed in a dry run');
    return 1;
  }
  if (opts.apply) {
    const refusal = applyRefusal({ env, stdinIsTTY: io.stdinIsTTY, stdoutIsTTY: io.stdoutIsTTY, ancestors: io.ancestors });
    if (refusal) {
      err(`x ${refusal}`);
      return 1;
    }
  }

  let version, marketplace, entry;
  try {
    version = readJson(path.join(cwd, MANIFEST)).version;
    marketplace = readJson(path.join(cwd, MARKETPLACE));
    entry = rigEntry(marketplace);
  } catch (e) {
    err(`x cannot read ${MANIFEST} / ${MARKETPLACE}: ${e.message}`);
    return 2;
  }
  if (typeof version !== 'string' || !isSemver(version)) fail(`${MANIFEST} version ${JSON.stringify(version)} is not strict semver`);
  if (!entry) fail(`${MARKETPLACE} has no "${PLUGIN_NAME}" plugin entry`);

  let branch, sha, tags;
  try {
    if (git(cwd, ['status', '--porcelain'], env)) fail('working tree is not clean (commit or stash first)');
    branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], env);
    sha = git(cwd, ['rev-parse', 'HEAD'], env);
    tags = git(cwd, ['tag', '--list', 'v*'], env).split('\n').filter(Boolean);
  } catch (e) {
    err(`x git failed: ${e.message}`);
    return 2;
  }
  if (branch !== 'main' && !opts.allowBranch) fail(`on branch "${branch}", not main (use --allow-branch for a beta)`);
  const releaseBranch = branch === 'main' && isSemver(version) ? `release/v${version}` : null;
  if (releaseBranch && gitOptional(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${releaseBranch}`], env)) {
    fail(`branch ${releaseBranch} already exists (delete it or finish that release first)`);
  }

  const latest = latestTag(tags);
  if (isSemver(version)) {
    if (tags.includes(`v${version}`)) fail(`v${version} is already tagged`);
    else if (latest && compareSemver(version, latest.slice(1)) <= 0) fail(`version ${version} is not greater than the latest tag ${latest}`);
    let changelog = '';
    try { changelog = fs.readFileSync(path.join(cwd, CHANGELOG), 'utf8'); } catch { /* missing: reported below */ }
    const problem = changelogProblem(changelog, version);
    if (problem) fail(problem);
  }

  const stale = (io.antigravityStale || antigravityStale)(cwd);
  if (stale) fail(stale);

  if (failures.length === 0) {
    if (opts.skipTests) log('! tests skipped (--skip-tests)');
    else if (!(io.runTests || runNpmTest)(cwd)) fail('npm test failed');
  }

  if (failures.length) {
    for (const f of failures) err(`x ${f}`);
    return 1;
  }

  const pinned = pinnedEntry(entry, { version, sha });
  const signing = Boolean(gitOptional(cwd, ['config', 'user.signingkey'], env) || gitOptional(cwd, ['config', 'gpg.format'], env));
  log(`${opts.apply ? 'Releasing' : 'Dry run:'} Rig ${version} (latest tag: ${latest || 'none'}, branch: ${branch})`);
  log(`  content commit (tag target + sha): ${sha}`);
  log(`  marketplace entry -> ${JSON.stringify(pinned.source)}`);
  log(`  tag: v${version} (${signing ? 'signed' : 'annotated'}) on ${sha.slice(0, 12)}`);
  log(`  pin commit on: ${releaseBranch ? `${releaseBranch} (new branch; main is merged by pull request)` : branch}`);
  if (!opts.apply) {
    log('Nothing written. Re-run with --apply in a terminal outside Claude Code to release.');
    return 0;
  }

  const confirm = io.confirm || (async () => false);
  if (!(await confirm(`Commit the marketplace pin${releaseBranch ? ` on ${releaseBranch}` : ''} and create tag v${version}?`))) {
    err('x not confirmed, nothing changed');
    return 1;
  }

  if (releaseBranch) {
    try {
      git(cwd, ['checkout', '-b', releaseBranch], env);
    } catch (e) {
      err(`x cannot create branch ${releaseBranch}: ${e.message}`);
      return 1;
    }
  }
  try {
    marketplace.plugins = marketplace.plugins.map((p) => (p === entry ? pinned : p));
    fs.writeFileSync(path.join(cwd, MARKETPLACE), `${JSON.stringify(marketplace, null, 2)}\n`);
    git(cwd, ['add', MARKETPLACE], env);
    git(cwd, ['commit', '-m', `release: pin marketplace to v${version}`, '--', MARKETPLACE], env);
  } catch (e) {
    err(`x marketplace commit failed: ${e.message}\n  undo with: git checkout -- ${MARKETPLACE}`);
    return 1;
  }
  try {
    git(cwd, tagArgs({ version, sha, signingConfigured: signing }), env);
  } catch (e) {
    err(`x tag failed: ${e.message}\n  the marketplace commit exists; fix the cause, then: git tag ${signing ? '-s' : '-a'} v${version} ${sha} -m "Rig ${version}"`);
    return 1;
  }
  const pinBranch = releaseBranch || branch;
  log(`Created commit "release: pin marketplace to v${version}" on ${pinBranch} and tag v${version} -> ${sha.slice(0, 12)}. Nothing was pushed. Next:`);
  if (releaseBranch) {
    log(`  git push -u origin ${releaseBranch}`);
    log(`  gh pr create --base main --head ${releaseBranch} --title "release: pin marketplace to v${version}" --body "Release pin for v${version}."`);
    log(`  # after CI on the pull request passes:`);
    log(`  git checkout main && git merge --ff-only ${releaseBranch} && git push origin main v${version}`);
    log(`  git push origin --delete ${releaseBranch} && git branch -d ${releaseBranch}`);
  } else {
    log(`  git push origin ${branch} v${version}`);
  }
  log(`  install: ${installHint(pinned.source.url, releaseBranch ? 'main' : branch)}`);
  log(`  gh release create v${version} --title "Rig ${version}" --notes-file <CHANGELOG section> ${/-/.test(version) ? '--prerelease' : '--latest'}   # after the tag is pushed; docs/how-to/release-rig.md step 7`);
  log(`  claude plugin tag plugins/rig --dry-run   # optional: makes the plugin-scoped rig--v${version} tag, then rerun without --dry-run (add --push to publish it)`);
  return 0;
}

/**
 * The marketplace add command testers use. The pin lives in the commit AFTER the tag, so the marketplace must be
 * read from the branch that carries it (main by default); adding it at the tag gets the unpinned entry, which
 * resolves the plugin from the default branch (live: "Subdirectory 'plugins/rig' not found" before 2.0 reached main).
 */
function installHint(url, branch) {
  const m = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/.exec(String(url || ''));
  const source = m ? m[1] : url;
  return `/plugin marketplace add ${source}${branch === 'main' ? '' : `#${branch}`}, then /plugin install rig@rig-marketplace (not #v<tag>: the pin is after the tag)`;
}

/**
 * CI: on main the marketplace pin must equal the latest v* tag reachable from HEAD, and its sha that tag's commit.
 * No ref yet (pre-release state) is a notice, not a failure.
 * @returns {{ ok: boolean, skipped?: boolean, message: string }}
 */
function checkMarketplaceRef(cwd, env) {
  const entry = rigEntry(readJson(path.join(cwd, MARKETPLACE)));
  if (!entry) return { ok: false, message: `${MARKETPLACE} has no "${PLUGIN_NAME}" plugin entry` };
  const src = entry.source || {};
  if (!src.ref) return { ok: true, skipped: true, message: 'marketplace entry has no ref yet (pre-release state); skipping' };
  const latest = latestTag(git(cwd, ['tag', '--list', 'v*', '--merged', 'HEAD'], env).split('\n').filter(Boolean));
  if (!latest) return { ok: false, message: `marketplace ref is ${src.ref} but no v* tag is reachable from HEAD (CI needs fetch-depth: 0)` };
  if (src.ref !== latest) return { ok: false, message: `marketplace ref ${src.ref} is not the latest reachable tag ${latest}` };
  if (entry.version !== undefined && `v${entry.version}` !== src.ref) return { ok: false, message: `marketplace version ${entry.version} does not match ref ${src.ref}` };
  const tagSha = git(cwd, ['rev-parse', `${latest}^{commit}`], env);
  if (src.sha !== tagSha) return { ok: false, message: `marketplace sha ${src.sha} is not the commit of ${latest} (${tagSha})` };
  return { ok: true, message: `marketplace pins ${latest} @ ${tagSha.slice(0, 12)}` };
}

async function main(argv) {
  const { opts, error } = parseArgs(argv);
  if (error) {
    console.error(`x ${error}\nusage: release-plugin.cjs [--apply] [--allow-branch] [--skip-tests] | --check-ref`);
    return 2;
  }
  const cwd = path.resolve(__dirname, '..');
  if (opts.checkRef) {
    try {
      const r = checkMarketplaceRef(cwd, process.env);
      if (r.skipped) console.log(`::notice::${r.message}`);
      else console.log(`${r.ok ? 'OK' : 'x'} marketplace ref check: ${r.message}`);
      return r.ok ? 0 : 1;
    } catch (e) {
      console.error(`x cannot check the marketplace ref: ${e.message}`);
      return 2;
    }
  }
  const { askYesNo } = require('../plugins/rig/scripts/rig-init/backup-restore-standalone.cjs');
  return release(opts, {
    cwd,
    env: process.env,
    stdinIsTTY: Boolean(process.stdin.isTTY),
    stdoutIsTTY: Boolean(process.stdout.isTTY),
    log: (m) => console.log(m),
    err: (m) => console.error(m),
    confirm: (q) => askYesNo(q),
  });
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(`x ${e.message}`); process.exitCode = 2; });
}

module.exports = {
  antigravityStale, release, latestTag, tagArgs, pinnedEntry, applyRefusal, checkMarketplaceRef, parseArgs, changelogProblem,
};
