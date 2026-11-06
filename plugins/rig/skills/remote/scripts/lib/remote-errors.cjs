'use strict';
/**
 * Exit codes + RemoteError, defined ONCE for the whole rig:remote skill.
 *   0 ok | 1 error | 2 usage/invalid input | 3 lock refused/unverifiable
 *   4 merge conflict | 5 worker transport (unreachable, command-not-found,
 *   bad-output, protocol-mismatch, timeout)
 */
const EXIT = Object.freeze({
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  LOCK: 3,
  CONFLICT: 4,
  TRANSPORT: 5,
});

class RemoteError extends Error {
  /**
   * @param {string} message human readable
   * @param {number} exitCode one of EXIT.*
   * @param {{class?: string, hint?: string}} [meta] machine-readable class + user hint
   */
  constructor(message, exitCode = EXIT.ERROR, meta = {}) {
    super(message);
    this.name = 'RemoteError';
    this.exitCode = exitCode;
    this.class = meta.class || null;
    this.hint = meta.hint || null;
  }
}

/** Shorthand for invalid-input errors (exit 2). */
function usageError(message, hint) {
  return new RemoteError(message, EXIT.USAGE, { class: 'invalid-input', hint });
}

module.exports = { EXIT, RemoteError, usageError };
