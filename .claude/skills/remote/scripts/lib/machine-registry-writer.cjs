'use strict';
/**
 * Writes ONE machine entry into the registry (`register` command). The whole file is
 * validated first (an invalid registry is never rewritten), the new entry goes through the
 * same validator as loadRegistry plus the allowedTools policy, and the file is replaced
 * atomically. Other entries are kept verbatim. The registry never holds secrets.
 */
const fs = require('fs');
const path = require('path');
const { RemoteError, usageError } = require('./remote-errors.cjs');
const { registryPath, loadRegistry, validateMachineEntry } = require('./machine-registry.cjs');
const { resolveAllowedTools, tokenizeTools } = require('./allowed-tools-policy.cjs');

/** CLI flags -> registry entry. shell defaults to bash (macos/linux) or powershell (windows). */
function buildMachineEntry(flags) {
  const entry = {
    ssh: flags.ssh,
    os: flags.os,
    shell: flags.shell || (flags.os === 'windows' ? 'powershell' : 'bash'),
    repo: flags.repo,
    // `;` is forbidden inside registry paths, so it is an unambiguous separator on every OS.
    pathPrepend: flags['path-prepend'] ? flags['path-prepend'].split(';').map((p) => p.trim()).filter(Boolean) : [],
  };
  if (flags.node) entry.node = flags.node;
  if (flags.claude) entry.claude = flags.claude;
  if (flags['allowed-tools']) entry.allowedTools = tokenizeTools(flags['allowed-tools']);
  if (flags['task-mode']) entry.taskMode = flags['task-mode'];
  return entry;
}

/** Raw JSON of an existing registry (after full validation), or a fresh skeleton when absent. */
function readRawRegistry(file) {
  try {
    loadRegistry();
  } catch (e) {
    if (e instanceof RemoteError && e.class === 'registry-missing' && !fs.existsSync(file)) return { machines: {} };
    throw e;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Merge `entry` (from flags) into the existing entry `prev` (or none). `projectKey` is the
 * normalized origin of the project register runs in ('' when it has none).
 * - new id: entry + repos[projectKey]
 * - --replace: entry rebuilt from flags, other projects' `repos` carried over, current key set
 * - existing id, no --replace: only adds/updates repos[projectKey]; every other given flag must
 *   equal the stored value (`givenKeys`), otherwise refuse and point at --replace
 * @returns {{next:object, action:'added'|'replaced'|'project-added'|'project-updated'}}
 */
function mergeMachineEntry(name, prev, entry, { replace, projectKey, givenKeys }) {
  const withKey = (repos) => (projectKey ? { ...repos, [projectKey]: entry.repo } : repos);
  const withRepos = (base, repos) => (repos && Object.keys(repos).length ? { ...base, repos } : base);
  if (!prev || replace) for (const req of ['ssh', 'os']) if (!entry[req]) throw usageError(`--${req} is required for a new or replaced machine`);
  if (!prev) return { next: withRepos(entry, withKey({})), action: 'added' };
  if (replace) return { next: withRepos(entry, withKey(prev.repos)), action: 'replaced' };
  const differs = givenKeys.filter((k) => k !== 'repo' && !same(entry[k], prev[k]));
  if (differs.length) throw usageError(`machine "${name}" already registered with a different ${differs.join(', ')}`, 'pass --replace to overwrite it');
  if (!projectKey) {
    throw usageError(`machine "${name}" already registered and this directory has no "origin" remote`, 'run register inside the project repo to add its clone, or pass --replace to overwrite the entry');
  }
  const had = Boolean(prev.repos && Object.prototype.hasOwnProperty.call(prev.repos, projectKey));
  return { next: { ...prev, repos: withKey(prev.repos || {}) }, action: had ? 'project-updated' : 'project-added' };
}

/**
 * Add `name`, add this project's clone to it, or (with replace) overwrite it.
 * @param {{replace?:boolean, projectKey?:string, givenKeys?:string[]}} opts
 * @returns {{path:string, created:boolean, action:string, entry:object, firstReposMap:boolean, previousRepo:string|null}}
 */
function upsertMachine(name, entry, { replace = false, projectKey = '', givenKeys = [] } = {}) {
  const file = registryPath();
  const created = !fs.existsSync(file);
  const data = readRawRegistry(file);
  const prev = Object.prototype.hasOwnProperty.call(data.machines, name) ? data.machines[name] : null;
  const { next, action } = mergeMachineEntry(name, prev, entry, { replace, projectKey, givenKeys });
  validateMachineEntry(name, next); // flags + repos collisions (dup/nested/-rig-test) across projects
  if (next.allowedTools) resolveAllowedTools(null, next.allowedTools); // same policy dispatch enforces
  data.machines[name] = next;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  // a legacy entry served every project through `repo`; with a map, unlisted projects get no-clone
  const firstReposMap = Boolean(prev && !prev.repos && next.repos);
  return { path: file, created, action, entry: next, firstReposMap, previousRepo: prev ? prev.repo : null };
}

module.exports = { buildMachineEntry, mergeMachineEntry, upsertMachine };
