/**
 * bash-process-kill-rule.cjs - rule `process-kill`.
 *
 * Claude Code's Bash shell has the WHOLE command string in its own argv, so `pkill -f <pattern>`
 * kills the shell running it whenever the pattern matches that string, not only for "plain"
 * patterns (`pkill -f '[s]erver.js'; node server.js &` still self-matches). Decisions:
 *   deny  pkill -f/--full whose pattern (as JS RegExp, approximating ERE) matches the full command
 *   deny  broad scope: pkill -u/-U/-g/-G/-P, killall -u, `kill 0`, `kill -- -1`, `kill -9 -1`
 *         (a lone `kill -1` is just the HUP signal with no pid, so it is not matched)
 *   deny  any kill/pkill in a command that also runs `pgrep -f <pat>` (pipeline, `$(...)`, backticks,
 *         `P=$(pgrep -f x)`, while-read loops) when
 *         the pattern self-matches the full command: pgrep lists this shell too, and the kill takes it down
 *   ask   pkill -f with an uncompilable or non-literal pattern
 *   ask   kill by common name (node, python, bash, ssh, git, claude, ...) and `killall -r`:
 *         may take down Claude Code or the user's sessions
 *   allow everything else (killall Finder, pkill myworker)
 * ReDoS (a hook timeout means allow): every match runs through regex-test-with-timeout.cjs (vm timeout,
 * the real bound); a timeout or compile error returns ask. Unsafe-shaped or over-long patterns and
 * commands over MAX_MATCHED_COMMAND_CHARS are rejected up front (cheap pre-filter), also ask.
 * Remedy text points at the bracket form and `pgrep -x <name>` (never a full-command pgrep, which self-matches).
 *
 * Contract: opaquePolicy 'inspect', crashPolicy 'allow'.
 */
const { commandName, tokenize } = require('./bash-command-segment-tokenizer.cjs');
const { checkRegexShape } = require('./unsafe-regex-shape-checker.cjs');
const { regexTestWithTimeout } = require('./regex-test-with-timeout.cjs');

const COMMON_NAMES = new Set(['node', 'python', 'python3', 'bash', 'sh', 'zsh', 'ssh', 'git', 'claude']);
const MAX_PATTERN_CHARS = 256;
const MAX_MATCHED_COMMAND_CHARS = 8192;
const REMEDY = "Use the bracket form `pkill -f '[v]ite'`, or find the PID with `pgrep -x <name>` (a full-command pgrep matches this shell too).";

// pkill options that take a value (letter, attached or next word) and long forms.
const PKILL_VALUE_SHORT = new Set(['u', 'U', 'g', 'G', 'P', 's', 't', 'F']);
const PKILL_BROAD_SHORT = new Set(['u', 'U', 'g', 'G', 'P']);
const PKILL_BROAD_LONG = new Set(['euid', 'uid', 'pgroup', 'group', 'parent']);
const PKILL_VALUE_LONG = new Set([...PKILL_BROAD_LONG, 'session', 'terminal', 'pidfile', 'signal', 'ns', 'nslist']);
const SIGNAL_WORD = /^-(\d+|[A-Z][A-Z0-9]+)$/; // -9, -KILL, -SIGHUP (not -U / -P style flags)

function deny(reason) {
  return { decision: 'deny', reason };
}

function ask(reason) {
  return { decision: 'ask', reason, context: reason };
}

/** Parses pkill argv. */
function parsePkill(args, dynamic) {
  const o = { full: false, exact: false, ignoreCase: false, broad: false, positional: [] };
  let end = false;
  for (let i = 0; i < args.length; i += 1) {
    const t = args[i];
    if (end || t === '-' || t[0] !== '-') {
      o.positional.push({ text: t, dynamic: Boolean(dynamic[i]) });
    } else if (t === '--') {
      end = true;
    } else if (t.startsWith('--')) {
      const long = t.slice(2).split('=')[0];
      if (long === 'full') o.full = true;
      else if (long === 'exact') o.exact = true;
      else if (long === 'ignore-case') o.ignoreCase = true;
      if (PKILL_BROAD_LONG.has(long)) o.broad = true;
      if (PKILL_VALUE_LONG.has(long) && !t.includes('=')) i += 1;
    } else if (!SIGNAL_WORD.test(t)) {
      for (let k = 1; k < t.length; k += 1) {
        const ch = t[k];
        if (ch === 'f') o.full = true;
        else if (ch === 'x') o.exact = true;
        else if (ch === 'i') o.ignoreCase = true;
        if (PKILL_VALUE_SHORT.has(ch)) {
          if (PKILL_BROAD_SHORT.has(ch)) o.broad = true;
          if (k === t.length - 1) i += 1;
          break;
        }
      }
    }
  }
  return o;
}

/**
 * Decides whether a `-f` pattern (pkill or pgrep) would match this command line. Returns null when
 * it provably does not, a deny when it does, an ask when that cannot be decided safely.
 * @param {string} tool 'pkill' | 'pgrep' (wording only)
 */
function fullPatternVerdict(o, pattern, ctx, tool) {
  if (pattern.dynamic) return ask(`${tool} -f pattern is not a literal, so a self-match with this shell cannot be ruled out. ${REMEDY}`);
  const shape = checkRegexShape(pattern.text, { maxLength: MAX_PATTERN_CHARS });
  if (!shape.safe || ctx.fullCommand.length > MAX_MATCHED_COMMAND_CHARS) {
    return ask(`${tool} -f pattern or command is too complex to check for a self-match with this shell. ${REMEDY}`);
  }
  // The vm timeout is the real bound (the shape check above is only a cheap pre-filter).
  const run = regexTestWithTimeout(pattern.text, o.ignoreCase ? 'i' : '', ctx.fullCommand);
  if (!run.ok) return ask(`${tool} -f pattern could not be checked for self-match with this shell (${run.reason}). ${REMEDY}`);
  if (run.matched) {
    return deny(`${tool} -f pattern matches this command line and would kill the shell running it. ${REMEDY}`);
  }
  return null;
}

/** Strongest verdict over the `pgrep -f` segments in `segments` (deny > ask > null). */
function pgrepFullVerdict(segments, ctx) {
  let found = null;
  for (const seg of segments) {
    if (commandName(seg) !== 'pgrep') continue;
    const o = parsePkill(seg.argv.slice(1), (seg.dynamic || []).slice(1));
    if (!o.full || !o.positional[0]) continue;
    const v = fullPatternVerdict(o, o.positional[0], ctx, 'pgrep');
    if (v && (!found || v.decision === 'deny')) found = v;
  }
  return found;
}

function checkPkill(segment, ctx) {
  const o = parsePkill(segment.argv.slice(1), (segment.dynamic || []).slice(1));
  if (o.broad) return deny(`pkill with a user/group/parent filter can kill Claude Code and unrelated sessions. ${REMEDY}`);
  const pattern = o.positional[0];
  if (!pattern) return null;

  if (o.full) return fullPatternVerdict(o, pattern, ctx, 'pkill');

  if (pattern.dynamic) return null;
  // Name match: -x is exact, otherwise substring (pkill semantics); only common names are risky.
  const source = o.exact ? `^(?:${pattern.text})$` : pattern.text;
  const hit = [...COMMON_NAMES].find((name) => {
    const run = regexTestWithTimeout(source, o.ignoreCase ? 'i' : '', name);
    return run.ok && run.matched;
  });
  return hit ? ask(`pkill '${pattern.text}' matches '${hit}', which may kill Claude Code or your sessions. ${REMEDY}`) : null;
}

function checkKillall(segment) {
  const args = segment.argv.slice(1);
  const names = [];
  let regex = false;
  let end = false;
  for (let i = 0; i < args.length; i += 1) {
    const t = args[i];
    if (end || t === '-' || t[0] !== '-') {
      names.push(t);
    } else if (t === '--') {
      end = true;
    } else if (t.startsWith('--')) {
      const long = t.slice(2).split('=')[0];
      if (long === 'user') return deny(`killall -u kills every process of a user, including Claude Code. ${REMEDY}`);
      if (long === 'regexp') regex = true;
      if (['signal', 'older-than', 'younger-than', 'context'].includes(long) && !t.includes('=')) i += 1;
    } else if (!SIGNAL_WORD.test(t)) {
      for (let k = 1; k < t.length; k += 1) {
        const ch = t[k];
        if (ch === 'u') return deny(`killall -u kills every process of a user, including Claude Code. ${REMEDY}`);
        if (ch === 'r') regex = true;
        if ('sZyo'.includes(ch)) {
          if (k === t.length - 1) i += 1;
          break;
        }
      }
    }
  }
  if (regex) return ask(`killall -r matches process names by regex and may kill Claude Code. ${REMEDY}`);
  const hit = names.find((n) => COMMON_NAMES.has(n.toLowerCase()));
  return hit ? ask(`killall ${hit} may kill Claude Code or your sessions. ${REMEDY}`) : null;
}

/** Index just past the `$( ... )` group whose `(` is at `open` (quote aware), or text end. */
function balancedParenEnd(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (c === '\\') i += 1;
    else if (c === "'" || c === '"') {
      const close = text.indexOf(c, i + 1);
      if (close === -1) return text.length;
      i = close;
    } else if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

/** Inner command texts of `$(...)` (balanced) and backtick groups in `text`. */
function substitutionTexts(text) {
  const out = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '$' && text[i + 1] === '(') {
      const end = balancedParenEnd(text, i + 1);
      out.push(text.slice(i + 2, text[end - 1] === ')' ? end - 1 : end));
      i = end - 1;
    } else if (text[i] === '`') {
      const close = text.indexOf('`', i + 1);
      out.push(text.slice(i + 1, close === -1 ? text.length : close));
      i = close === -1 ? text.length : close;
    }
  }
  return out;
}

const MAX_SUBSTITUTION_DEPTH = 3;

/**
 * Every `pgrep` segment the command can run: top-level segments plus those inside `$(...)` /
 * backticks anywhere (arguments, `P=$(pgrep -f x)` assignments, nested), found in segment raw text.
 */
function collectPgrepSegments(segments, cwd, depth = 0) {
  const found = [];
  for (const seg of segments) {
    if (commandName(seg) === 'pgrep') found.push(seg);
    if (depth >= MAX_SUBSTITUTION_DEPTH || !seg.raw || !/[$`]/.test(seg.raw)) continue;
    for (const inner of substitutionTexts(seg.raw)) {
      try {
        found.push(...collectPgrepSegments(tokenize(inner, { cwd }), cwd, depth + 1));
      } catch {
        // untokenizable substitution: nothing to check
      }
    }
  }
  return found;
}

function checkKill(segment, _ctx) {
  const args = segment.argv.slice(1);
  let sigSeen = false;
  let end = false;
  for (let i = 0; i < args.length; i += 1) {
    const t = args[i];
    let isPid = end || !(t[0] === '-' && t.length > 1);
    if (!isPid) {
      if (t === '--') {
        end = true;
        continue;
      }
      if (t === '-s' || t === '-n' || t === '--signal') {
        sigSeen = true;
        i += 1;
        continue;
      }
      if (!sigSeen && /^-[0-9A-Za-z]+$/.test(t)) {
        sigSeen = true;
        continue;
      }
      isPid = sigSeen; // `kill -9 -1`: the second dash-number is the pid
    }
    if (isPid && (t === '0' || t === '-1')) {
      return deny(`kill ${t} signals every process you own (or the whole process group), including Claude Code. ${REMEDY}`);
    }
  }
  return null;
}

/**
 * kill / pkill next to a self-matching `pgrep -f`: `pgrep -f v | xargs [-I{}] kill`, `kill $(pgrep -f v)`,
 * `P=$(pgrep -f v); kill $P`, `... | while read p; do kill $p; done`. Where the pids flow is not
 * modelled: any pgrep -f whose pattern matches the full command, plus any kill, is a deny.
 */
function checkPgrepFeedsKill(ctx) {
  if (!Array.isArray(ctx.segments)) return null;
  return pgrepFullVerdict(collectPgrepSegments(ctx.segments, ctx.cwd), ctx);
}

function check(segment, ctx) {
  switch (commandName(segment)) {
    case 'pkill': return checkPkill(segment, ctx) || checkPgrepFeedsKill(ctx);
    case 'killall': return checkKillall(segment);
    case 'kill': return checkKill(segment) || checkPgrepFeedsKill(ctx);
    default: return null;
  }
}

module.exports = {
  id: 'process-kill',
  configKey: 'processKill',
  opaquePolicy: 'inspect', // `kill $(pgrep -f x)` is an opaque segment
  crashPolicy: 'allow',
  check,
};
