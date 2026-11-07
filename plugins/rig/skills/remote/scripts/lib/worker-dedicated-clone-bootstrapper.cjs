'use strict';
/**
 * Worker side of `setup`: make the registry `repo` a Rig-dedicated clone with a known-good
 * baseline, so the first agent/test run does not fail `failed:prepare`.
 *   missing or empty dir -> clone origin, optional local identity, record baseline   (cloned)
 *   clean clone, baseline match -> nothing, or set identity + re-record              (unchanged | identity-set)
 *   clean clone, no/mismatched baseline -> record only with acceptExisting (user inspected) (baselined | needs-accept)
 *   quarantined, dirty, other origin, non-git dir, unpushed commits/stash (on accept) -> refuse
 *   a failed clone is removed again so a rerun starts fresh
 * Identity is written BEFORE the baseline is recorded: the clone config is part of the hash.
 */
const fs = require('fs');
const path = require('path');
const { usageError, RemoteError, EXIT } = require('./remote-errors.cjs');
const { tryGit } = require('./safe-git-runner.cjs');
const { isQuarantined } = require('./git-control-files-integrity.cjs');
const { writeKnownGoodBaseline, verifyKnownGoodBaseline } = require('./hardened-git-config-env.cjs');
const { normalizeOrigin } = require('./doctor-checks.cjs');

const PREPARE_TIMEOUT_MS = 15 * 60_000; // first clone of a large repo over a slow link (setup waits this long)

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

function refuse(message, hint) {
  return new RemoteError(message, EXIT.ERROR, { class: 'setup-refused', hint });
}

function assertOriginUrl(url) {
  if (typeof url !== 'string' || !url || url.length > 500 || url.startsWith('-') || /\s/.test(url) || CONTROL.test(url)) {
    throw usageError('prepare needs a plain originUrl');
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*::/.test(url)) throw usageError('remote-helper origin urls (<transport>::) are not allowed');
  return url;
}

function assertIdentity(identity) {
  if (!identity) return null;
  // trimmed: git returns trimmed values, so an untrimmed name would never compare equal
  const name = typeof identity.name === 'string' ? identity.name.trim() : '';
  const email = typeof identity.email === 'string' ? identity.email.trim() : '';
  const okText = (v, max) => v && v.length <= max && !CONTROL.test(v) && !v.startsWith('-');
  if (!okText(name, 100) || !okText(email, 200) || /\s/.test(email) || !email.includes('@')) {
    throw usageError('identity needs a non-empty name and an email like rig@example.com');
  }
  return { name, email };
}

/** Local user.name/user.email in the clone; true when something changed. */
function applyIdentity(repo, identity) {
  if (!identity) return false;
  let changed = false;
  for (const [key, value] of [['user.name', identity.name], ['user.email', identity.email]]) {
    if (tryGit(repo, ['config', '--local', '--get', key]).out === value) continue;
    const r = tryGit(repo, ['config', '--local', key, value]);
    if (!r.ok) throw refuse(`cannot set ${key} in ${repo}: ${r.err.slice(-200)}`);
    changed = true;
  }
  return changed;
}

/** Undo a failed/partial clone so a rerun starts fresh (an empty dir we were given stays, empty). */
function discardPartialClone(repo, existedEmpty) {
  try {
    fs.rmSync(repo, { recursive: true, force: true });
    if (existedEmpty) fs.mkdirSync(repo);
  } catch { /* best effort: the refusal below still names the directory */ }
}

function cloneInto(repo, originUrl, identity, existedEmpty) {
  fs.mkdirSync(path.dirname(repo), { recursive: true });
  const c = tryGit(path.dirname(repo), ['clone', '--quiet', '--no-local', '--', originUrl, repo], { timeoutMs: PREPARE_TIMEOUT_MS - 30_000 });
  if (!c.ok) {
    discardPartialClone(repo, existedEmpty);
    throw refuse(`git clone into ${repo} failed: ${c.err.slice(-300)}`,
      'this worker user needs read+push access to origin (ssh key or deploy key with write access; prefer an ssh origin url)');
  }
  try {
    applyIdentity(repo, identity);
    return { action: 'cloned', hash: writeKnownGoodBaseline(repo) };
  } catch (e) {
    discardPartialClone(repo, existedEmpty); // else a rerun would demand --accept-existing-clone for our own clone
    throw e;
  }
}

/** Work an existing clone holds outside origin: it would be lost by the per-run reset. */
function localOnlyWork(repo) {
  const unpushed = tryGit(repo, ['log', '--branches', '--not', '--remotes', '-1', '--format=%h']);
  const stash = tryGit(repo, ['stash', 'list']);
  if (!unpushed.ok || !stash.ok) return `cannot inspect local branches/stash: ${(unpushed.err || stash.err).slice(-200)}`;
  if (unpushed.out) return `local branches have commits not on origin (e.g. ${unpushed.out})`;
  if (stash.out) return 'it has stashed changes';
  return null;
}

const isEmptyDir = (dir) => fs.statSync(dir).isDirectory() && fs.readdirSync(dir).length === 0;

/**
 * @param {{repo:string, originUrl:string, acceptExisting?:boolean, identity?:{name,email}}} input
 * @returns {{repo, action:'cloned'|'unchanged'|'identity-set'|'baselined'|'needs-accept', hash?:string, hint?:string}}
 */
function prepareDedicatedClone({ repo, originUrl, acceptExisting = false, identity = null }) {
  if (typeof repo !== 'string' || !path.isAbsolute(repo)) throw usageError('prepare needs an absolute target.repo');
  assertOriginUrl(originUrl);
  const id = assertIdentity(identity);
  if (!fs.existsSync(repo)) return { repo, ...cloneInto(repo, originUrl, id, false) };
  if (isEmptyDir(repo)) return { repo, ...cloneInto(repo, originUrl, id, true) };
  const top = tryGit(repo, ['rev-parse', '--git-dir']);
  if (!top.ok) {
    if (/not a git repository/i.test(top.err)) throw refuse(`${repo} exists and is not a git clone`, 'point "repo" at a new path, or empty that directory');
    throw refuse(`cannot inspect ${repo}: ${top.err.slice(-300)}`, 'check git on the worker (installed, owner of the directory = the worker user)');
  }
  if (isQuarantined(repo)) throw refuse(`${repo} is quarantined (git config/hooks were tampered with)`, `inspect it, delete ${repo}, then rerun setup to re-clone`);
  const origin = tryGit(repo, ['config', '--get', 'remote.origin.url']).out;
  if (normalizeOrigin(origin) !== normalizeOrigin(originUrl)) {
    throw refuse(`${repo} has origin ${normalizeOrigin(origin) || '(none)'}, orchestrator uses ${normalizeOrigin(originUrl)}`, `use a dedicated clone of the orchestrator's origin (delete ${repo} and rerun setup)`);
  }
  const status = tryGit(repo, ['status', '--porcelain']);
  if (!status.ok) throw refuse(`git status failed in ${repo}: ${status.err.slice(-300)}`);
  if (status.out) throw refuse(`${repo} has uncommitted changes; a Rig-dedicated clone must be clean`, 'it is reset on every run: never work in it by hand');
  const v = verifyKnownGoodBaseline(repo);
  if (v.status === 'match') {
    if (!applyIdentity(repo, id)) return { repo, action: 'unchanged', hash: v.expected };
    return { repo, action: 'identity-set', hash: writeKnownGoodBaseline(repo) };
  }
  // missing or mismatch: same trust decision as a manual `worker.cjs baseline`, so only on explicit request
  if (!acceptExisting) {
    const why = v.status === 'missing' ? 'existing clone has no baseline' : 'git config/hooks/info (clone or global gitconfig) changed since the baseline';
    return { repo, action: 'needs-accept', hint: `${why}: inspect ${repo}/.git/config, its hooks and your global gitconfig, then rerun setup with --accept-existing-clone (or delete ${repo} and rerun setup to re-clone)` };
  }
  const local = localOnlyWork(repo);
  if (local) throw refuse(`${repo} is not safe to adopt: ${local}`, `push or drop that work first (runs reset the clone), or point "repo" at a new path`);
  applyIdentity(repo, id);
  return { repo, action: 'baselined', hash: writeKnownGoodBaseline(repo) };
}

module.exports = { prepareDedicatedClone, PREPARE_TIMEOUT_MS };
