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

/**
 * Add or (with replace) overwrite `name`.
 * @returns {{path:string, created:boolean, replaced:boolean, entry:object}}
 */
function upsertMachine(name, entry, { replace = false } = {}) {
  validateMachineEntry(name, entry);
  if (entry.allowedTools) resolveAllowedTools(null, entry.allowedTools); // same policy dispatch enforces
  const file = registryPath();
  const created = !fs.existsSync(file);
  const data = readRawRegistry(file);
  const replaced = Object.prototype.hasOwnProperty.call(data.machines, name);
  if (replaced && !replace) throw usageError(`machine "${name}" already in ${file}`, 'pass --replace to overwrite it');
  data.machines[name] = entry;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  return { path: file, created, replaced, entry };
}

module.exports = { buildMachineEntry, upsertMachine };
