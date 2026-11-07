/**
 * unsafe-regex-shape-checker.cjs - conservative ReDoS shape check for regexes a hook is about to run.
 *
 * Hooks have a short timeout and Claude Code treats a timed-out hook as non-blocking, so a
 * catastrophic-backtracking pattern turns a guard into an allow. Before compiling a pattern that
 * came from a command line or a config file, call checkRegexShape(): it is a scanner, not a regex
 * engine, and prefers false positives (reject) over false negatives.
 *
 * Rejected:
 *   - longer than maxLength (default 200)
 *   - unbalanced groups / unterminated character class
 *   - backreferences (\1..\9, \k<name>)
 *   - a repeated group (`+`, `*`, `{n,}`, `{n,m}`) that contains a variable quantifier at any depth
 *     (`(a+)+`, `((a+))+`, `(a{1,})+`) or an alternation at any depth (`(a|aa)+`, `((a|b))*`)
 *   - more than MAX_UNBOUNDED_QUANTIFIERS unbounded quantifiers overall (polynomial blowup,
 *     `a*a*a*b`); callers also cap the length of the text they match against
 *
 * Export: checkRegexShape(source, {maxLength}) -> {safe: boolean, reason: string}
 */
const DEFAULT_MAX_LENGTH = 200;
const MAX_UNBOUNDED_QUANTIFIERS = 2;
const RANGE_QUANTIFIER = /^\{(\d+)(,(\d*))?\}/;

function unsafe(reason) {
  return { safe: false, reason };
}

/** Index just past the `[...]` class starting at `open`, or -1 when unterminated. */
function skipClass(src, open) {
  let i = open + 1;
  if (src[i] === '^') i += 1;
  if (src[i] === ']') i += 1; // a leading ] is literal
  for (; i < src.length; i += 1) {
    if (src[i] === '\\') i += 1;
    else if (src[i] === ']') return i + 1;
  }
  return -1;
}

/** Length of the group-prefix after `(` that is not an atom: `?:`, `?=`, `?!`, `?<=`, `?<!`, `?<name>`. */
function groupPrefixLength(src, i) {
  if (src[i] !== '?') return 0;
  if (src[i + 1] === '<' && src[i + 2] !== '=' && src[i + 2] !== '!') {
    const close = src.indexOf('>', i);
    return close === -1 ? 1 : close - i + 1;
  }
  if (src[i + 1] === '<') return 3;
  return 2;
}

/** Quantifier text at `i`: {len, variable, unbounded} or null. `?` is bounded and ignored. */
function quantifierAt(src, i) {
  const c = src[i];
  if (c === '+' || c === '*') return { len: 1, variable: true, unbounded: true };
  if (c === '{') {
    const m = RANGE_QUANTIFIER.exec(src.slice(i, i + 24));
    if (m && m[2] !== undefined) return { len: m[0].length, variable: true, unbounded: m[3] === '' };
    if (m) return { len: m[0].length, variable: false, unbounded: false };
  }
  return null;
}

/**
 * @param {string} source regex source text
 * @param {{maxLength?: number}} [opts]
 * @returns {{safe: boolean, reason: string}}
 */
function checkRegexShape(source, opts = {}) {
  const maxLength = opts.maxLength || DEFAULT_MAX_LENGTH;
  if (typeof source !== 'string') return unsafe('not a string');
  if (source.length > maxLength) return unsafe(`longer than ${maxLength} chars`);

  const stack = [{ variable: false, alt: false }];
  let unbounded = 0;
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    const top = stack[stack.length - 1];
    if (c === '\\') {
      const next = source[i + 1];
      if (next !== undefined && (/[1-9]/.test(next) || next === 'k')) return unsafe('backreference');
      i += 1;
    } else if (c === '[') {
      const end = skipClass(source, i);
      if (end === -1) return unsafe('unterminated character class');
      i = end - 1;
    } else if (c === '(') {
      stack.push({ variable: false, alt: false });
      i += groupPrefixLength(source, i + 1);
    } else if (c === ')') {
      if (stack.length < 2) return unsafe('unbalanced group');
      const group = stack.pop();
      const parent = stack[stack.length - 1];
      const q = quantifierAt(source, i + 1);
      const repeated = Boolean(q && q.variable);
      if (repeated && (group.variable || group.alt)) return unsafe('repeated group contains a quantifier or alternation');
      parent.variable = parent.variable || group.variable || repeated;
      parent.alt = parent.alt || group.alt;
    } else if (c === '|') {
      top.alt = true;
    } else {
      const q = quantifierAt(source, i);
      if (q) {
        top.variable = top.variable || q.variable;
        if (q.unbounded) unbounded += 1;
        i += q.len - 1;
      }
    }
  }
  if (stack.length !== 1) return unsafe('unbalanced group');
  if (unbounded > MAX_UNBOUNDED_QUANTIFIERS) return unsafe(`more than ${MAX_UNBOUNDED_QUANTIFIERS} unbounded quantifiers`);
  return { safe: true, reason: '' };
}

module.exports = { checkRegexShape, DEFAULT_MAX_LENGTH, MAX_UNBOUNDED_QUANTIFIERS };
