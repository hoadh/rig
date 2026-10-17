'use strict';
/**
 * Builds the `claude -p` argv, resolves the binary and classifies the outcome.
 * The prompt (task.md) goes to claude via STDIN, never argv. The permission
 * mode is hard-coded; `bypassPermissions` / `--dangerously-skip-permissions`
 * are never built (see test).
 */
const fs = require('fs');
const { ALWAYS_DISALLOWED } = require('./allowed-tools-policy.cjs');
const path = require('path');

const PERMISSION_MODE = 'acceptEdits';

/** @param {{maxTurns:number, agent:{sessionId:string, resume:boolean, allowedTools:string[], disallowedTools:string[], settings?:string}}} spec */
function buildClaudeArgs(spec) {
  const a = spec.agent;
  const args = [
    '-p',
    a.resume ? '--resume' : '--session-id', a.sessionId,
    '--output-format', 'json',
    '--permission-mode', PERMISSION_MODE,
    '--permission-prompts', 'none',
    '--max-turns', String(spec.maxTurns),
  ];
  if (a.settings) args.push('--settings', a.settings); // optional hook/permission override file on the worker
  // worker re-adds the fixed denylist: a spec from an older or edited orchestrator cannot drop it
  args.push('--disallowedTools', ...new Set([...ALWAYS_DISALLOWED, ...a.disallowedTools]));
  args.push('--allowedTools', ...a.allowedTools); // variadic: keep last
  return args;
}

/**
 * Registry `claude` abs path, else PATH lookup. win32 requires a real .exe
 * (a .cmd/.ps1 shim cannot be spawned without a shell).
 * @returns {string|null}
 */
function resolveClaudeBinary(target, env = process.env, platform = process.platform) {
  if (target && target.claude) return target.claude;
  const win = platform === 'win32';
  const names = win ? ['claude.exe'] : ['claude'];
  const dirs = String((win ? env.Path || env.PATH : env.PATH) || '').split(win ? ';' : ':').filter(Boolean);
  for (const d of dirs) {
    for (const n of names) {
      const p = path.join(d, n);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* next */ }
    }
  }
  return null;
}

const AUTH_RE = /not logged in|please run \/login|invalid api key|authentication[_ ]error|oauth token (?:has )?expired|\b401\b|unauthorized|credit balance is too low/i;
const RATE_RE = /rate[ _-]?limit|\b429\b|usage limit|too many requests|overloaded|\b529\b/i;

/** Parse `--output-format json` stdout; tolerant of trailing noise. null when unparsable. */
function parseClaudeJson(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  try { return JSON.parse(t); } catch { /* maybe noise around the object */ }
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  if (i >= 0 && j > i) { try { return JSON.parse(t.slice(i, j + 1)); } catch { /* fall through */ } }
  return null;
}

/**
 * Classify an agent outcome (never auto-resumes; just names the failure).
 * @returns {string|null} 'timeout'|'cancelled'|'auth'|'ratelimit'|'agent'|null
 */
function classifyAgentOutcome({ code, timedOut, cancelled, stderr, json }) {
  if (cancelled) return 'cancelled';
  if (timedOut) return 'timeout';
  const isError = json ? json.is_error === true || (typeof json.subtype === 'string' && json.subtype.startsWith('error')) : false;
  if (code === 0 && !isError) return null;
  const text = `${stderr || ''}\n${json && typeof json.result === 'string' ? json.result : ''}`;
  if (AUTH_RE.test(text)) return 'auth';
  if (RATE_RE.test(text)) return 'ratelimit';
  return 'agent';
}

module.exports = { PERMISSION_MODE, buildClaudeArgs, resolveClaudeBinary, parseClaudeJson, classifyAgentOutcome, AUTH_RE, RATE_RE };
