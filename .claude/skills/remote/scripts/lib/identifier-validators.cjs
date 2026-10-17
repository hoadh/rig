'use strict';
/**
 * Validators for every identifier that may reach an ssh command line, a git
 * ref or a filesystem path. `isX` returns boolean; `assertX` throws exit-2
 * RemoteError naming the field. Allowlist regexes only - never sanitise.
 */
const { usageError } = require('./remote-errors.cjs');

const RE = {
  machine: /^[a-z0-9][a-z0-9-]{0,31}$/,
  slug: /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/,
  runId: /^[a-z0-9][a-z0-9-]{7,79}$/,
  phaseId: /^[0-9]{2}$/,
  sha: /^[0-9a-f]{40}$/,
  sshTarget: /^[A-Za-z0-9_][A-Za-z0-9_.@-]*$/,
  token: /^[A-Za-z0-9_./:=\\-]+$/,
  sub: /^[a-z]+$/,
};

const isMachineName = (v) => typeof v === 'string' && RE.machine.test(v);
const isSlug = (v) =>
  typeof v === 'string' && RE.slug.test(v) && !v.includes('..') && !v.endsWith('.lock');
const isRunId = (v) => typeof v === 'string' && RE.runId.test(v);
const isPhaseId = (v) => typeof v === 'string' && RE.phaseId.test(v);
const isSha = (v) => typeof v === 'string' && RE.sha.test(v);
const isSub = (v) => typeof v === 'string' && RE.sub.test(v);
/** ssh target: no leading '-', and '@-' would smuggle an option after user@. */
const isSshTarget = (v) =>
  typeof v === 'string' && RE.sshTarget.test(v) && !v.includes('@-') && v.length <= 255;
/** Token allowed in the ssh remote command string (same parse in bash/cmd/pwsh). */
const isInvocationToken = (v) => typeof v === 'string' && RE.token.test(v);

// Rejected in every path: shell/cmd metacharacters, quotes, expansion chars.
const BAD_PATH_ALL = /[%^&|<>"!'$`;*?[\]{}#]/;
// Additionally rejected for posix paths (windows keeps \ and parentheses).
const BAD_PATH_POSIX = /[\\()]/;

/**
 * Returns the offending reason string or null when the path is acceptable.
 * @param {string} p
 * @param {'macos'|'linux'|'windows'} os
 * @param {{allowSpaces?: boolean}} [opts] spaces only for node/claude executables
 *   (builder quotes them) and pathPrepend entries (only ever joined into the PATH env var,
 *   never a command line); repo must stay space-free.
 */
function pathProblem(p, os, opts = {}) {
  if (typeof p !== 'string' || p.length === 0 || p.length > 500) return 'must be a non-empty string';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(p)) return 'contains control characters';
  if (/\s/.test(p.replace(opts.allowSpaces ? / /g : '', ''))) return 'contains whitespace';
  const bad = p.match(BAD_PATH_ALL) || (os !== 'windows' ? p.match(BAD_PATH_POSIX) : null);
  // node/claude (allowSpaces) are quoted into a cmd/powershell command line: parentheses break
  // cmd's /c quote rule (e.g. "Program Files (x86)"), so refuse them with a way out.
  if (!bad && opts.allowSpaces && os === 'windows' && /[()]/.test(p)) {
    return 'contains parentheses, which cannot be quoted safely for cmd/powershell; use the 8.3 short path (`dir /x`) or install outside "Program Files (x86)"';
  }
  if (bad) return `contains forbidden character ${JSON.stringify(bad[0])}`;
  const absolute = os === 'windows' ? /^[A-Za-z]:[\\/]/.test(p) : p.startsWith('/');
  if (!absolute) return `is not an absolute ${os} path`;
  if (p.split(/[\\/]/).includes('..')) return 'contains ..';
  return null;
}

const isAbsPath = (p, os, opts) => pathProblem(p, os, opts) === null;

function makeAssert(isFn, label, example) {
  return (v, field = label) => {
    if (!isFn(v)) {
      throw usageError(`invalid ${field}: ${JSON.stringify(v)}`, `expected ${example}`);
    }
    return v;
  };
}

function assertAbsPath(p, os, field = 'path', opts) {
  const problem = pathProblem(p, os, opts);
  if (problem) throw usageError(`invalid ${field} ${JSON.stringify(p)}: ${problem}`);
  return p;
}

module.exports = {
  isMachineName, isSlug, isRunId, isPhaseId, isSha, isSub, isSshTarget,
  isInvocationToken, isAbsPath, pathProblem,
  assertMachineName: makeAssert(isMachineName, 'machine', '^[a-z0-9][a-z0-9-]{0,31}$'),
  assertSlug: makeAssert(isSlug, 'slug', '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$, no "..", not ending .lock'),
  assertRunId: makeAssert(isRunId, 'runId', '^[a-z0-9][a-z0-9-]{7,79}$'),
  assertPhaseId: makeAssert(isPhaseId, 'phaseId', 'two digits'),
  assertSha: makeAssert(isSha, 'sha', '40 lowercase hex chars'),
  assertSub: makeAssert(isSub, 'subcommand', '^[a-z]+$'),
  assertSshTarget: makeAssert(isSshTarget, 'ssh target', 'user@host without leading "-" or "@-"'),
  assertInvocationToken: makeAssert(isInvocationToken, 'argument', '^[A-Za-z0-9_./:=\\\\-]+$'),
  assertAbsPath,
};
