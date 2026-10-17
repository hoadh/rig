'use strict';
/**
 * Validates the run spec sent by the orchestrator (stdin payload of `start|exec`).
 * Strict: unknown keys are errors, so nothing (e.g. a nonce, a permission
 * mode override) can ride along. Permission mode is fixed `acceptEdits`
 * (see claude-headless-args), never taken from the spec.
 */
const crypto = require('crypto');
const { usageError } = require('./remote-errors.cjs');
const V = require('./identifier-validators.cjs');
const { workerBranch } = require('./rig-branch-and-path-names.cjs');
const { validateAllowedTools } = require('./allowed-tools-policy.cjs');

const SPEC_KEYS = ['v', 'runId', 'orchestrator', 'slug', 'phase', 'kind', 'baseSha', 'startSha', 'branch', 'owns', 'ref', 'command', 'timeoutSec', 'maxTurns', 'agent'];
const AGENT_KEYS = ['sessionId', 'resume', 'allowedTools', 'disallowedTools', 'settings'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

function unknownKeys(obj, allowed, where) {
  const bad = Object.keys(obj).find((k) => !allowed.includes(k));
  if (bad) throw usageError(`${where}: unknown key "${bad}"`, `allowed: ${allowed.join(', ')}`);
}

function intInRange(v, min, max, field) {
  if (!Number.isInteger(v) || v < min || v > max) throw usageError(`${field} must be an integer ${min}..${max}, got ${JSON.stringify(v)}`);
  return v;
}

function stringList(v, field, { nonEmpty }) {
  if (!Array.isArray(v) || (nonEmpty && v.length === 0)) throw usageError(`${field} must be ${nonEmpty ? 'a non-empty ' : 'an '}array of strings`);
  v.forEach((s, i) => {
    if (typeof s !== 'string' || !s || s.length > 300 || CONTROL_RE.test(s)) throw usageError(`${field}[${i}] must be a short printable string`);
  });
  return v;
}

/** owns globs: relative, no "..", no backslash, no leading "/". */
function validateOwns(owns) {
  stringList(owns, 'owns', { nonEmpty: true });
  owns.forEach((g, i) => {
    if (g.startsWith('/') || g.includes('\\') || g.split('/').includes('..')) throw usageError(`owns[${i}] ${JSON.stringify(g)} must be a relative posix glob without ".."`);
  });
}

/**
 * @param {object} spec parsed JSON from the orchestrator
 * @param {{self: string, registryTools?: string[]}} ctx worker machine id (branch must be rig/<self>/<slug>);
 *   registryTools = the target's registry allowedTools (extends the tool baseline)
 * @returns {object} the same spec when valid; throws exit-2 RemoteError otherwise
 */
function validateSpec(spec, { self, registryTools = [] }) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw usageError('spec must be an object');
  unknownKeys(spec, SPEC_KEYS, 'spec');
  if (spec.v !== 1) throw usageError(`unsupported spec version ${JSON.stringify(spec.v)}`);
  V.assertRunId(spec.runId, 'runId');
  V.assertMachineName(spec.orchestrator, 'orchestrator');
  if (spec.phase !== null && spec.phase !== undefined) V.assertPhaseId(spec.phase, 'phase');
  intInRange(spec.timeoutSec, 1, 86_400, 'timeoutSec');
  if (spec.kind === 'command') {
    V.assertSha(spec.ref, 'ref');
    if (spec.slug) V.assertSlug(spec.slug);
    if (typeof spec.command !== 'string' || !spec.command.trim() || spec.command.length > 8192 || spec.command.includes('\0')) {
      throw usageError('command must be a non-empty string (<= 8192 chars, no NUL)');
    }
    for (const k of ['baseSha', 'startSha', 'branch', 'owns', 'maxTurns', 'agent']) {
      if (spec[k] !== undefined) throw usageError(`spec.${k} is not valid for kind "command"`);
    }
  } else if (spec.kind === 'agent') {
    V.assertSlug(spec.slug, 'slug');
    V.assertSha(spec.baseSha, 'baseSha');
    V.assertSha(spec.startSha, 'startSha');
    const expected = workerBranch(self, spec.slug);
    if (spec.branch !== expected) throw usageError(`branch ${JSON.stringify(spec.branch)} must be ${expected}`);
    validateOwns(spec.owns);
    intInRange(spec.maxTurns, 1, 1000, 'maxTurns');
    if (spec.ref !== undefined || spec.command !== undefined) throw usageError('spec.ref/command are not valid for kind "agent"');
    const a = spec.agent;
    if (!a || typeof a !== 'object' || Array.isArray(a)) throw usageError('spec.agent must be an object');
    unknownKeys(a, AGENT_KEYS, 'spec.agent');
    if (typeof a.sessionId !== 'string' || !UUID_RE.test(a.sessionId)) throw usageError('agent.sessionId must be a UUID');
    if (typeof a.resume !== 'boolean') throw usageError('agent.resume must be boolean');
    stringList(a.allowedTools, 'agent.allowedTools', { nonEmpty: true });
    validateAllowedTools(a.allowedTools, registryTools); // worker-side policy: orchestrator bypass still fails
    stringList(a.disallowedTools, 'agent.disallowedTools', { nonEmpty: false });
    if (a.settings !== undefined) { // optional `claude --settings <file>`; the file lives on the worker
      const ok = V.isAbsPath(a.settings, 'macos') || V.isAbsPath(a.settings, 'windows');
      if (!ok) throw usageError('agent.settings must be an absolute path without whitespace/shell metacharacters');
    }
  } else {
    throw usageError(`kind must be "agent" or "command", got ${JSON.stringify(spec.kind)}`);
  }
  return spec;
}

/** Stable hash (sorted keys) for idempotent `start` by runId. */
function specHash(spec) {
  const canon = (v) => (Array.isArray(v) ? v.map(canon)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
  return crypto.createHash('sha256').update(JSON.stringify(canon(spec))).digest('hex');
}

module.exports = { validateSpec, specHash, SPEC_KEYS };
