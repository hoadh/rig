/**
 * bash-command-segment-tokenizer.cjs - splits a Bash command string into simple-command segments.
 *
 * Shared by the bash-safety-guard PreToolUse hook and the verification hooks (which anchor a
 * verify command to the command word of a segment instead of grepping the raw text).
 *
 * This is NOT a full shell parser. It is a conservative scanner that answers "which commands
 * would this string run, with which words, in which directory":
 *   - splits on unquoted `;` `&&` `||` `|` `&` newline and subshell parentheses
 *   - understands single/double quotes, backslash escapes, `#` comments, redirections, heredocs
 *   - anything it cannot model (`$(...)`, backticks, `<(...)`, heredocs, unbalanced quotes)
 *     marks the segment `opaque: true`; `raw` still carries the original text so strict
 *     rules can inspect it
 *   - strips execution prefixes (sudo, env, nice, timeout, xargs, watch, ...) so argv[0] is the
 *     real command word, and re-tokenizes `sh|bash|zsh [-o opt] -c '<literal>'` and `eval <words>`
 *   - tracks `cd <literal>` so each segment knows its working directory
 *
 * Segment: { argv: string[], dynamic: boolean[] (parallel to argv: word holds a variable, glob or
 *            brace expansion), raw, opaque, cwd, cwdUnknown, fullCommand,
 *            op: operator that ended the segment: ';' '&&' '||' '|' '&' '\\n' '(' ')' or '' at the end }
 *
 * Exports: tokenize(command, {cwd, cwdUnknown}), commandName(segment), expandHome(p)
 */
const os = require('os');
const path = require('path');

const MAX_SHELL_DEPTH = 3;
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
// Shell reserved words that may precede a command word.
const RESERVED = new Set(['{', '!', 'then', 'do', 'else', 'elif', 'if', 'while', 'until']);
const CD_COMMANDS = new Set(['cd', 'pushd']);
// Operators after which a `cd` in the same shell persists for the next segment.
const CD_PERSISTS = new Set(['', ';', '&&', '||', '\n', ')']);

/** Per-prefix option tables: short flags / long flags that take a value argument. */
const PREFIXES = {
  sudo: { short: 'ugphCDRTUrt', long: ['user', 'group', 'host', 'prompt', 'chdir', 'close-from', 'role', 'type', 'other-user', 'command-timeout', 'chroot'] },
  doas: { short: 'uC', long: [] },
  env: { short: 'uCS', long: ['unset', 'chdir', 'split-string'], assignments: true },
  nice: { short: 'n', long: ['adjustment'] },
  timeout: { short: 'sk', long: ['signal', 'kill-after'], positional: 1 },
  xargs: { short: 'InLPsEda', long: ['max-args', 'max-procs', 'max-lines', 'max-chars', 'delimiter', 'arg-file', 'process-slot-var'] },
  watch: { short: 'n', long: ['interval'] },
  time: { short: 'fo', long: ['format', 'output'] },
  exec: { short: 'a', long: [] },
  command: { short: '', long: [] },
  builtin: { short: '', long: [] },
  nohup: { short: '', long: [] },
  setsid: { short: '', long: [] },
};

function expandHome(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Lower-cased basename of argv[0] ('' when empty); `/usr/bin/pkill` -> `pkill`. */
function commandName(segment) {
  const head = segment && segment.argv && segment.argv[0];
  if (!head) return '';
  return path.posix.basename(head.replace(/\\/g, '/')).toLowerCase().replace(/\.exe$/, '');
}

// ---------------------------------------------------------------------------
// Prefix stripping
// ---------------------------------------------------------------------------

/**
 * Index after the option words starting at `idx`. `short`: letters of value-taking short flags
 * (value attached or in the next word); `long`: value-taking long flags (without `--`).
 */
function skipOptions(words, idx, spec) {
  while (idx < words.length) {
    const t = words[idx].text;
    if (t === '--') return idx + 1;
    if (t.length < 2 || t[0] !== '-') break;
    if (t.startsWith('--')) {
      const eq = t.indexOf('=');
      if (eq === -1 && spec.long.includes(t.slice(2))) idx += 2;
      else idx += 1;
      continue;
    }
    let consumed = 1;
    for (let k = 1; k < t.length; k += 1) {
      if (spec.short.includes(t[k])) {
        if (k === t.length - 1) consumed = 2; // value is the next word
        break;
      }
    }
    idx += consumed;
  }
  return idx;
}

/** Drops execution prefixes (and leading VAR=val assignments) until the real command word. */
function stripPrefixes(words) {
  let a = words.slice();
  for (let guard = 0; guard < 20 && a.length > 0; guard += 1) {
    const head = a[0].text;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(head) || RESERVED.has(head)) {
      a = a.slice(1);
      continue;
    }
    const name = path.posix.basename(head.replace(/\\/g, '/')).toLowerCase();
    const spec = PREFIXES[name];
    if (!spec) break;
    // `command -v x` / `command -V x` only looks a command up; leave it alone.
    if (name === 'command' && a.slice(1).some((w) => /^-[a-zA-Z]*[vV]/.test(w.text))) break;
    let idx = skipOptions(a, 1, spec);
    if (spec.assignments) {
      while (idx < a.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(a[idx].text)) idx += 1;
    }
    idx += spec.positional || 0;
    a = a.slice(Math.min(idx, a.length));
  }
  return a;
}

/**
 * `bash -c '<script>'` (options such as `-o pipefail` / `+o x` / `-O opt` may come before `-c`) or
 * `eval <words>` -> the script text to re-scan, else null.
 */
function shellDashCScript(words) {
  if (words.length < 2) return null;
  const name = path.posix.basename(words[0].text.replace(/\\/g, '/'));
  if (name === 'eval') return words.slice(1).map((w) => w.text).join(' ');
  if (words.length < 3 || !SHELLS.has(name)) return null;
  for (let i = 1; i < words.length; i += 1) {
    const t = words[i].text;
    if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(t)) return i + 1 < words.length ? words[i + 1].text : null;
    if (/^[-+][a-zA-Z]*[oO]$/.test(t)) {
      i += 1; // the option's value (`pipefail`, `extglob`) is not the script
      continue;
    }
    if (t === '--' || t[0] !== '-') return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

const REDIRECT = /^(\d*|&)(>>|>\||>&|>|<<<|<&|<>|<)/;

/** Removes redirection words (`> out`, `2>&1`, `<<< x`) so they are not mistaken for arguments. */
function dropRedirections(words) {
  const out = [];
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    const m = !w.quoted && REDIRECT.exec(w.text);
    if (!m) {
      out.push(w);
    } else if (w.text.length === m[0].length) {
      i += 1; // target is the next word
    }
  }
  return out;
}

/** Index just past a `$( )` / `<( )` / `>( )` group starting at the `(` at `open`, or text end. */
function skipParenGroup(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (c === '\\') i += 1;
    else if (c === "'") {
      const close = text.indexOf("'", i + 1);
      if (close === -1) return text.length;
      i = close;
    } else if (c === '"') {
      for (i += 1; i < text.length && text[i] !== '"'; i += 1) if (text[i] === '\\') i += 1;
    } else if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

/** Index just past a backtick group starting at `open`, or text end. */
function skipBacktickGroup(text, open) {
  for (let i = open + 1; i < text.length; i += 1) {
    if (text[i] === '\\') i += 1;
    else if (text[i] === '`') return i + 1;
  }
  return text.length;
}

/** Index after the bodies of all pending heredocs, which start at `pos`. */
function skipHeredocBodies(text, pos, pending) {
  let i = pos;
  for (const { delim, dash } of pending) {
    while (i < text.length) {
      let nl = text.indexOf('\n', i);
      if (nl === -1) nl = text.length;
      let line = text.slice(i, nl);
      i = Math.min(nl + 1, text.length);
      if (dash) line = line.replace(/^\t+/, '');
      if (line === delim) break;
    }
  }
  return i;
}

/** Reads a heredoc delimiter word at `i` (after `<<`/`<<-`); returns {delim, end}. */
function readHeredocDelimiter(text, i) {
  let j = i;
  while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j += 1;
  let delim = '';
  while (j < text.length && !/[\s;&|()<>]/.test(text[j])) {
    if (text[j] === "'" || text[j] === '"') {
      const close = text.indexOf(text[j], j + 1);
      const end = close === -1 ? text.length : close;
      delim += text.slice(j + 1, end);
      j = close === -1 ? text.length : close + 1;
    } else {
      if (text[j] !== '\\') delim += text[j];
      j += 1;
    }
  }
  return { delim, end: j };
}

function applyCd(words, cwd, unknown) {
  let idx = 1;
  while (idx < words.length && /^-[LPe@]+$/.test(words[idx].text)) idx += 1;
  if (idx < words.length && words[idx].text === '--') idx += 1;
  if (idx >= words.length) return { cwd: os.homedir(), unknown: false };
  const target = words[idx];
  if (target.text === '-' || target.dynamic) return { cwd, unknown: true };
  const expanded = expandHome(target.text);
  if (path.isAbsolute(expanded)) return { cwd: expanded, unknown: false };
  if (unknown) return { cwd, unknown: true };
  return { cwd: path.resolve(cwd, expanded), unknown: false };
}

/**
 * @param {string} text command text
 * @param {{cwd:string, unknown:boolean}} start initial working directory state
 * @param {string} fullCommand original full command (a Bash tool's argv holds all of it)
 * @param {number} depth sh -c nesting depth
 */
function scan(text, start, fullCommand, depth) {
  const segments = [];
  const cwdStack = [];
  let { cwd, unknown } = start;
  let words = [];
  let cur = null;
  let opaque = false;
  let segStart = 0;
  let pending = []; // heredocs awaiting their body at the next newline
  const n = text.length;
  let i = 0;

  const word = () => {
    if (!cur) cur = { text: '', dynamic: false, quoted: false };
    return cur;
  };
  const endWord = () => {
    if (cur) words.push(cur);
    cur = null;
  };
  // Appends a group the scanner cannot model verbatim to the current word and marks it opaque.
  const takeOpaque = (end) => {
    const w = word();
    w.text += text.slice(i, end);
    w.dynamic = true;
    opaque = true;
    i = end;
  };

  /** Finishes the segment ending at `rawEnd`; `op` is the operator that ended it. */
  const endSegment = (rawEnd, op) => {
    endWord();
    if (words.length > 0 || opaque) {
      const raw = text.slice(segStart, rawEnd).trim();
      const stripped = stripPrefixes(dropRedirections(words));
      const script = depth < MAX_SHELL_DEPTH ? shellDashCScript(stripped) : null;
      const subs = script === null ? [] : scan(script, { cwd, unknown }, fullCommand, depth + 1);
      if (subs.length === 0 || opaque) {
        segments.push({
          argv: stripped.map((w) => w.text),
          dynamic: stripped.map((w) => w.dynamic),
          raw,
          opaque,
          cwd,
          cwdUnknown: unknown,
          fullCommand,
          op,
        });
      }
      // The operator after the whole `bash -c '...'` also follows its last inner command.
      if (subs.length > 0 && subs[subs.length - 1].op === '') subs[subs.length - 1].op = op;
      segments.push(...subs);
      if (!opaque && stripped.length > 0 && CD_COMMANDS.has(stripped[0].text) && CD_PERSISTS.has(op)) {
        ({ cwd, unknown } = applyCd(stripped, cwd, unknown));
      }
    }
    words = [];
    opaque = false;
  };

  while (i < n) {
    const c = text[i];

    if (c === '\n') {
      let rawEnd = i;
      let next = i + 1;
      if (pending.length > 0) {
        next = skipHeredocBodies(text, i + 1, pending);
        if (opaque) rawEnd = next;
        pending = [];
      }
      endSegment(rawEnd, '\n');
      i = next;
      segStart = i;
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endWord();
      i += 1;
    } else if (c === '#' && !cur) {
      while (i < n && text[i] !== '\n') i += 1;
    } else if (c === '\\') {
      if (text[i + 1] === '\n') {
        i += 2; // line continuation
      } else if (i + 1 < n) {
        const w = word();
        w.text += text[i + 1];
        w.quoted = true;
        i += 2;
      } else {
        i += 1;
      }
    } else if (c === "'") {
      const w = word();
      w.quoted = true;
      const close = text.indexOf("'", i + 1);
      if (close === -1) {
        w.text += text.slice(i + 1);
        opaque = true;
        i = n;
      } else {
        w.text += text.slice(i + 1, close);
        i = close + 1;
      }
    } else if (c === '"') {
      const w = word();
      w.quoted = true;
      i += 1;
      let closed = false;
      while (i < n) {
        const d = text[i];
        if (d === '"') {
          closed = true;
          i += 1;
          break;
        }
        if (d === '\\' && i + 1 < n && '$"\\`\n'.includes(text[i + 1])) {
          if (text[i + 1] !== '\n') w.text += text[i + 1];
          i += 2;
        } else if (d === '$' && text[i + 1] === '(') {
          takeOpaque(skipParenGroup(text, i + 1));
        } else if (d === '`') {
          takeOpaque(skipBacktickGroup(text, i));
        } else {
          if (d === '$') w.dynamic = true;
          w.text += d;
          i += 1;
        }
      }
      if (!closed) opaque = true;
    } else if (c === '`') {
      takeOpaque(skipBacktickGroup(text, i));
    } else if (c === '$' && text[i + 1] === '(') {
      takeOpaque(skipParenGroup(text, i + 1));
    } else if (c === '$') {
      const w = word();
      w.dynamic = true;
      w.text += c;
      i += 1;
    } else if (c === '(' && cur && (cur.text.endsWith('<') || cur.text.endsWith('>'))) {
      takeOpaque(skipParenGroup(text, i)); // process substitution <( ) / >( )
    } else if (c === '<' && text.startsWith('<<<', i)) {
      word().text += '<<<'; // here-string: a plain redirection, not a heredoc
      i += 3;
    } else if (c === '<' && text[i + 1] === '<') {
      // heredoc: body is consumed at the next newline; segment becomes opaque
      const dash = text[i + 2] === '-';
      const { delim, end } = readHeredocDelimiter(text, i + (dash ? 3 : 2));
      pending.push({ delim, dash });
      opaque = true;
      i = end;
    } else if (c === ';') {
      endSegment(i, ';');
      i += 1;
      segStart = i;
    } else if (c === '|') {
      const len = text[i + 1] === '|' ? 2 : text[i + 1] === '&' ? 2 : 1;
      endSegment(i, len === 2 && text[i + 1] === '|' ? '||' : '|');
      i += len;
      segStart = i;
    } else if (c === '&') {
      const prev = i > 0 ? text[i - 1] : '';
      if (prev === '>' || prev === '<' || text[i + 1] === '>') {
        const w = word();
        w.text += c; // part of a redirection: >&2, 2>&1, &>file
        i += 1;
      } else {
        const len = text[i + 1] === '&' ? 2 : 1;
        endSegment(i, len === 2 ? '&&' : '&');
        i += len;
        segStart = i;
      }
    } else if (c === '(') {
      endSegment(i, '(');
      cwdStack.push({ cwd, unknown });
      i += 1;
      segStart = i;
    } else if (c === ')') {
      endSegment(i, ')');
      if (cwdStack.length > 0) ({ cwd, unknown } = cwdStack.pop());
      i += 1;
      segStart = i;
    } else {
      const w = word();
      if (c === '*' || c === '?' || c === '[' || c === '{') w.dynamic = true;
      w.text += c;
      i += 1;
    }
  }
  endSegment(n, '');
  return segments;
}

/**
 * @param {string} command Bash command text
 * @param {{cwd?: string, cwdUnknown?: boolean}} [opts] starting directory (default process.cwd())
 * @returns {Array<{argv:string[], dynamic:boolean[], raw:string, opaque:boolean, cwd:string, cwdUnknown:boolean, fullCommand:string}>}
 */
function tokenize(command, opts = {}) {
  const text = typeof command === 'string' ? command : '';
  const start = { cwd: opts.cwd || process.cwd(), unknown: Boolean(opts.cwdUnknown) };
  return scan(text, start, text, 0);
}

module.exports = { tokenize, commandName, expandHome };
