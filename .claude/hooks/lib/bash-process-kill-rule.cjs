/**
 * bash-process-kill-rule.cjs - rule `process-kill`.
 *
 * Claude Code's Bash shell has the WHOLE command string in its own argv, so `pkill -f <pattern>`
 * kills the shell running it whenever the pattern matches that string, not only for "plain"
 * patterns (`pkill -f '[s]erver.js'; node server.js &` still self-matches). Decisions:
 *   deny  pkill -f/--full whose pattern (as JS RegExp, approximating ERE) matches the full command
 *   deny  broad scope: pkill -u/-U/-g/-G/-P, killall -u, `kill -1` / `kill 0` / `kill -- -1`
 *   ask   pkill -f with an uncompilable or non-literal pattern
 *   ask   kill by common name (node, python, bash, ssh, git, claude, ...) and `killall -r`:
 *         may take down Claude Code or the user's sessions
 *   allow everything else (killall Finder, pkill myworker)
 * Remedy text points at the bracket form and pgrep-by-PID.
 *
 * Contract: opaquePolicy 'skip', crashPolicy 'allow'.
 */
const { commandName } = require('./bash-command-segment-tokenizer.cjs');

const COMMON_NAMES = new Set(['node', 'python', 'python3', 'bash', 'sh', 'zsh', 'ssh', 'git', 'claude']);
const REMEDY = "Use the bracket form `pkill -f '[v]ite'`, or kill the specific PID from `pgrep -x <name>` / `pgrep -af '<pattern>'`.";

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

function checkPkill(segment, ctx) {
  const o = parsePkill(segment.argv.slice(1), (segment.dynamic || []).slice(1));
  if (o.broad) return deny(`pkill with a user/group/parent filter can kill Claude Code and unrelated sessions. ${REMEDY}`);
  const pattern = o.positional[0];
  if (!pattern) return null;

  if (o.full) {
    if (pattern.dynamic) return ask(`pkill -f pattern is not a literal, so a self-match with this shell cannot be ruled out. ${REMEDY}`);
    let re;
    try {
      re = new RegExp(pattern.text, o.ignoreCase ? 'i' : '');
    } catch {
      return ask(`pkill -f pattern could not be checked for self-match with this shell. ${REMEDY}`);
    }
    if (re.test(ctx.fullCommand)) {
      return deny(`pkill -f pattern matches this command line and would kill the shell running it. ${REMEDY}`);
    }
    return null;
  }

  if (pattern.dynamic) return null;
  // Name match: -x is exact, otherwise substring (pkill semantics); only common names are risky.
  let re;
  try {
    re = new RegExp(o.exact ? `^(?:${pattern.text})$` : pattern.text, o.ignoreCase ? 'i' : '');
  } catch {
    return null;
  }
  const hit = [...COMMON_NAMES].find((name) => re.test(name));
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

function checkKill(segment) {
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

function check(segment, ctx) {
  switch (commandName(segment)) {
    case 'pkill': return checkPkill(segment, ctx);
    case 'killall': return checkKillall(segment);
    case 'kill': return checkKill(segment);
    default: return null;
  }
}

module.exports = {
  id: 'process-kill',
  configKey: 'processKill',
  opaquePolicy: 'skip',
  crashPolicy: 'allow',
  check,
};
