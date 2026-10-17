'use strict';
/**
 * Machine registry: RIG_MACHINES_FILE else ~/.claude/rig-machines.json.
 * Strict minimal schema - unknown keys are errors so typos never go silent.
 * The registry holds no secrets (loader flags secret-looking keys).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RemoteError, EXIT, usageError } = require('./remote-errors.cjs');
const V = require('./identifier-validators.cjs');

const OSES = ['macos', 'linux', 'windows'];
const SHELLS = ['bash', 'cmd', 'pwsh', 'powershell'];
const TASK_MODES = ['interactive', 'headless'];
const ALLOWED_KEYS = ['ssh', 'os', 'shell', 'repo', 'pathPrepend', 'node', 'claude', 'allowedTools', 'taskMode'];
const SECRET_KEY = /token|secret|passw|api[-_]?key|credential/i;

function registryPath() {
  return process.env.RIG_MACHINES_FILE || path.join(os.homedir(), '.claude', 'rig-machines.json');
}

/** Self id: RIG_MACHINE else lowercased hostname with domain stripped. */
function selfMachineId() {
  const raw = process.env.RIG_MACHINE || os.hostname().split('.')[0];
  return String(raw).toLowerCase();
}

function oneOf(v, list, field) {
  if (!list.includes(v)) throw usageError(`${field} must be one of ${list.join('|')}, got ${JSON.stringify(v)}`);
}

/** Validate one machine entry; returns a normalised copy. Throws exit-2 RemoteError. */
function validateMachineEntry(name, entry) {
  V.assertMachineName(name, 'machine name');
  const where = `machine "${name}"`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw usageError(`${where}: entry must be an object`);
  for (const key of Object.keys(entry)) {
    if (ALLOWED_KEYS.includes(key)) continue;
    const secret = SECRET_KEY.test(key) ? ' (looks like a secret - never store secrets in the registry)' : '';
    throw usageError(`${where}: unknown key "${key}"${secret}`, `allowed keys: ${ALLOWED_KEYS.join(', ')}`);
  }
  for (const req of ['ssh', 'os', 'shell', 'repo', 'pathPrepend']) {
    if (entry[req] === undefined) throw usageError(`${where}: missing required key "${req}"`);
  }
  V.assertSshTarget(entry.ssh, `${where} ssh`);
  oneOf(entry.os, OSES, `${where} os`);
  oneOf(entry.shell, SHELLS, `${where} shell`);
  if (entry.os !== 'windows' && entry.shell !== 'bash') throw usageError(`${where}: shell "${entry.shell}" only valid for os=windows`);
  if (entry.os === 'windows' && entry.shell === 'bash') throw usageError(`${where}: shell bash not supported for os=windows`);
  V.assertAbsPath(entry.repo, entry.os, `${where} repo`);
  if (!Array.isArray(entry.pathPrepend)) throw usageError(`${where}: pathPrepend must be an array`);
  entry.pathPrepend.forEach((p, i) => V.assertAbsPath(p, entry.os, `${where} pathPrepend[${i}]`, { allowSpaces: true }));
  for (const exe of ['node', 'claude']) {
    if (entry[exe] !== undefined) V.assertAbsPath(entry[exe], entry.os, `${where} ${exe}`, { allowSpaces: true });
  }
  if (entry.os === 'windows' && !entry.node) {
    throw usageError(`${where}: "node" (absolute node.exe path) is required for os=windows`);
  }
  if (entry.allowedTools !== undefined) {
    if (!Array.isArray(entry.allowedTools) || entry.allowedTools.some((t) => typeof t !== 'string' || !t)) {
      throw usageError(`${where}: allowedTools must be an array of non-empty strings`);
    }
  }
  if (entry.taskMode !== undefined) {
    if (entry.os !== 'windows') throw usageError(`${where}: taskMode is only valid for os=windows`);
    oneOf(entry.taskMode, TASK_MODES, `${where} taskMode`);
  }
  return { name, ...entry };
}

/** Load + validate the whole registry. Returns { path, machines: {name: entry} }. */
function loadRegistry() {
  const file = registryPath();
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new RemoteError(`cannot read machine registry ${file}: ${e.code || e.message}`, EXIT.USAGE, {
      class: 'registry-missing',
      hint: 'create it, or point RIG_MACHINES_FILE at one (see skill remote docs)',
    });
  }
  let data;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch (e) {
    throw usageError(`registry ${file} is not valid JSON: ${e.message}`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw usageError(`registry ${file}: top level must be an object`);
  const extra = Object.keys(data).filter((k) => k !== 'machines');
  if (extra.length) throw usageError(`registry ${file}: unknown top-level key "${extra[0]}"`);
  if (!data.machines || typeof data.machines !== 'object' || Array.isArray(data.machines)) {
    throw usageError(`registry ${file}: "machines" must be an object`);
  }
  const machines = {};
  for (const [name, entry] of Object.entries(data.machines)) machines[name] = validateMachineEntry(name, entry);
  return { path: file, machines };
}

/** Fetch one validated machine entry or throw exit 2 listing known machines. */
function getMachine(name) {
  V.assertMachineName(name, 'machine');
  const reg = loadRegistry();
  const m = reg.machines[name];
  if (!m) throw usageError(`machine "${name}" not in registry ${reg.path}`, `known: ${Object.keys(reg.machines).join(', ') || '(none)'}`);
  return m;
}

module.exports = { registryPath, selfMachineId, validateMachineEntry, loadRegistry, getMachine, OSES, SHELLS };
