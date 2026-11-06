'use strict';
/**
 * Picks the worker clone for the project the orchestrator runs in. A registry entry may hold
 * `repos: {"<normalized origin>": "<abs path>"}` (one clone per project); the orchestrator's
 * cwd origin selects one. Workers stay project-agnostic: they always receive a RESOLVED target
 * with a single `repo` and no `repos` map, so older workers keep working unchanged.
 */
const { RemoteError, EXIT } = require('./remote-errors.cjs');
const { getMachine } = require('./machine-registry.cjs');
const { normalizeOrigin } = require('./git-origin-url-normalizer.cjs');
const { git } = require('./rig-local-worktree.cjs');

const originMemo = new Map(); // cwd -> origin url ('' when none): one git call per process

/** `git remote get-url origin` of cwd, '' when cwd is not a repo or has no origin. */
function projectOriginUrl(cwd = process.cwd()) {
  if (!originMemo.has(cwd)) {
    const r = git(cwd, ['remote', 'get-url', 'origin']);
    originMemo.set(cwd, r.status === 0 ? String(r.stdout).trim() : '');
  }
  return originMemo.get(cwd);
}

/**
 * Pure resolution: repos[key] -> it; legacy entry (no repos) or no origin -> `repo`;
 * map present but project missing -> exit-2 `no-clone` (never silently share another clone).
 * @returns {object} cfg with the chosen `repo` and without `repos`
 */
function resolveRepoForProject(cfg, originUrl) {
  const { repos, ...rest } = cfg;
  const key = originUrl ? normalizeOrigin(originUrl) : '';
  if (repos && key && Object.prototype.hasOwnProperty.call(repos, key)) return { ...rest, repo: repos[key] };
  if (!repos || !key) return rest;
  throw new RemoteError(`no clone of ${key} on ${cfg.name}`, EXIT.USAGE, { class: 'no-clone',
    hint: `in this project run \`remote.cjs register ${cfg.name} --repo <abs clone path>\` then \`remote.cjs setup ${cfg.name}\`` });
}

/** true/false = this project has/lacks a clone on the machine; null = cwd has no origin. */
function hasCloneForProject(cfg, originUrl) {
  if (!originUrl) return null;
  return !cfg.repos || Object.prototype.hasOwnProperty.call(cfg.repos, normalizeOrigin(originUrl));
}

/** Registry entry resolved for the project at cwd (throws `no-clone` exit 2). */
function getMachineForProject(name, cwd = process.cwd()) {
  return resolveRepoForProject(getMachine(name), projectOriginUrl(cwd));
}

module.exports = { projectOriginUrl, resolveRepoForProject, hasCloneForProject, getMachineForProject };
