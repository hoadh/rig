/**
 * regex-test-with-timeout.cjs - runs a user-supplied regex with a hard time bound.
 *
 * Shape checks (unsafe-regex-shape-checker.cjs) cannot bound every catastrophic pattern, and a
 * hook that times out is treated by Claude Code as non-blocking. This helper compiles and runs
 * `new RegExp(source, flags).test(text)` inside a reused vm context and cached `vm.Script` with a `timeout`, which V8
 * enforces even inside a backtracking regex. Verified on Node 26 (see the tests).
 *
 * After the first timeout in a process the helper short-circuits every later call (a hook is a
 * short-lived process: one pathological pattern must not cost the timeout several times).
 *
 * Export: regexTestWithTimeout(source, flags, text, {timeoutMs}) ->
 *           {ok: true, matched: boolean} | {ok: false, reason: 'timeout' | 'invalid'}
 */
const vm = require('vm');

const DEFAULT_TIMEOUT_MS = 250;
const MAX_CACHED_SCRIPTS = 100;
let timedOut = false;
let context = null;
const scripts = new Map(); // `${flags}/${source}` -> vm.Script (compiled once, reused across commands)

function scriptFor(source, flags) {
  const key = `${flags}/${source}`;
  let script = scripts.get(key);
  if (!script) {
    if (scripts.size >= MAX_CACHED_SCRIPTS) scripts.clear();
    // a bad pattern throws SyntaxError when the script runs, never while compiling this wrapper
    script = new vm.Script(`new RegExp(${JSON.stringify(source)}, ${JSON.stringify(flags)}).test(text)`);
    scripts.set(key, script);
  }
  return script;
}

function regexTestWithTimeout(source, flags, text, opts = {}) {
  if (timedOut) return { ok: false, reason: 'timeout' };
  try {
    if (!context) context = vm.createContext({ text: '' });
    context.text = text;
    const matched = scriptFor(source, flags).runInContext(context, { timeout: opts.timeoutMs || DEFAULT_TIMEOUT_MS });
    return { ok: true, matched: matched === true };
  } catch (error) {
    if (error && error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
      timedOut = true;
      return { ok: false, reason: 'timeout' };
    }
    return { ok: false, reason: 'invalid' }; // SyntaxError from the pattern
  }
}

/** Test hook: forget a previous timeout. */
function resetTimeoutLatch() {
  timedOut = false;
}

module.exports = { regexTestWithTimeout, resetTimeoutLatch, DEFAULT_TIMEOUT_MS };
