'use strict';
/**
 * Concrete tool policy for headless worker agents, enforced on the
 * orchestrator (dispatch) AND on the worker (run-spec-validator). allowedTools
 * is a seatbelt, not a sandbox: real containment = env allowlist + owns/denylist
 * before push + orchestrator review. CLI `--allowed-tools` may only NARROW.
 */
const { usageError } = require('./remote-errors.cjs');

const BASELINE = [
  'Read', 'Edit', 'Write', 'Glob', 'Grep',
  'Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)',
];
// `--output <file>` (diff/log/show) writes anywhere the user can, outside the repo and the owns gate (acceptance 261015).
// Seatbelt only: the rule matches raw command text, so shell quoting (`--o''utput=`) slips past it.
const ALWAYS_DISALLOWED = ['Bash(git push:*)', 'Bash(git config:*)', 'Bash(git remote:*)', 'Bash(git * --output*)'];
const PLAIN_TOOLS = new Set(['Read', 'Edit', 'Write', 'Glob', 'Grep']);
const FORBIDDEN_FIRST_WORDS = new Set([
  'sh', 'bash', 'zsh', 'cmd', 'pwsh', 'powershell', 'node', 'python', 'python3', 'perl', 'ruby',
  'deno', 'bun', 'curl', 'wget', 'ssh', 'scp',
  // runners that fetch+execute packages or arbitrary scripts, and programs with built-in exec
  'npx', 'bunx', 'pnpx', 'find', 'make', 'gmake', 'awk', 'gawk', 'mawk', 'nawk', 'osascript', 'mshta', 'rundll32',
  'sed', 'gsed', // GNU sed `e` / `s///e` executes shell
  'cscript', 'wscript', 'regsvr32', 'php', 'lua', 'luajit', 'tsx', 'ts-node', 'pip', 'pip3', 'pipx', 'uv', 'uvx',
  // command wrappers: `env node`, `xargs sh`, `sudo git push` ... run any command, so deny outright
  'env', 'xargs', 'nice', 'nohup', 'timeout', 'stdbuf', 'command', 'exec', 'sudo', 'doas', 'su', 'time',
  'ionice', 'setsid', 'script', 'busybox', 'eval', 'builtin', 'chroot', 'unbuffer', 'watch', 'flock',
]);
// Versioned interpreter names: python3.12, php8.2, node18, pypy3, ruby3.3 ...
const VERSIONED_INTERPRETER = /^(?:python|pypy|ruby|perl|php|lua|luajit|node|nodejs|deno|bun|tsx|ts-node|pip|ipython)[\d.-]*$/;
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
// Package-manager subcommands that download+run code (npm test / npm run stay: see references/worker-hooks-and-settings.md).
const PM_EXEC_SUBS = {
  npm: ['exec', 'x', 'create', 'init', 'explore', 'rebuild', 'rb'], // explore/rebuild run arbitrary shell cmds / lifecycle scripts
  pnpm: ['dlx', 'exec', 'x', 'create'],
  yarn: ['dlx', 'exec', 'create', 'workspace', 'workspaces'], // workspace(s) <name> run <any subcommand>
};
// git subcommand ALLOWLIST (rebase --exec, fetch/pull/clone, submodule, filter-branch, am, bisect run ... all run or reach out).
const ALLOWED_GIT_SUBS = new Set(['add', 'commit', 'status', 'diff', 'log', 'show', 'restore', 'rm', 'mv']);
const SHELL_META = /[;&|`$<>()\\\n\r]/;

/**
 * Subcommand of an npm/pnpm/yarn invocation = first word that is not an option or an option's value.
 * Options taking a separate value (`--prefix a`, `-C dir`, `--workspace w`...) are skipped with their value, so
 * `npm --prefix a exec` is caught while `npm run init` / `pnpm run exec` (script names) are not.
 * An option before the subcommand that is in NEITHER known set (`npm --otp 1 exec`: unknown whether it takes a
 * value) is reported as `bad`, because the real subcommand could hide behind its value (review round 3, low).
 * @returns {{sub: string|null, bad: string|null}}
 */
/*
 * Option tables per package manager. npm/pnpm parse options with nopt: an option unknown to the PM is treated
 * as a BOOLEAN (it consumes no value), so listing an option as value-taking when the PM does not would swallow
 * the real subcommand (`npm --config exec` runs exec). Only options verified for that PM are listed; anything
 * else before the subcommand is rejected (fail closed). `--opt.key=value` (pnpm `--config.k=v`) is one unknown
 * word and is rejected too. `--color` is omitted on purpose: npm takes an optional separate value (`--color always`).
 */
const NPM_VALUE = ['--prefix', '-C', '--workspace', '-w', '--registry', '--userconfig', '--globalconfig', '--cache', '--loglevel'];
const PNPM_VALUE = ['--dir', '-C', '--filter', '-F', '--registry', '--loglevel', '--store-dir', '--cache-dir'];
const YARN_VALUE = ['--cwd', '--registry', '--cache-folder', '--modules-folder'];
const COMMON_BOOL = [
  '--silent', '-s', '--quiet', '-q', '--verbose', '-d', '--json', '--global', '-g', '--workspaces', '--workspaces-update',
  '--include-workspace-root', '--if-present', '--ignore-scripts', '--offline', '--prefer-offline', '--no-audit', '--no-fund',
  '--legacy-peer-deps', '--force', '-f', '--production', '--frozen-lockfile', '--no-color', '--help', '-h', '--version', '-v', '-V',
];
const PM_OPTS = {
  npm: { value: new Set(NPM_VALUE), bool: new Set([...COMMON_BOOL, '--recursive', '-r']) },
  // pnpm: `-w` is `--workspace-root` (boolean), not npm's `--workspace <name>`
  pnpm: { value: new Set(PNPM_VALUE), bool: new Set([...COMMON_BOOL, '--recursive', '-r', '-w', '--workspace-root']) },
  yarn: { value: new Set(YARN_VALUE), bool: new Set([...COMMON_BOOL, '--recursive', '-r']) },
};
function pmSubcommand(args, pm = 'npm') {
  const opts = PM_OPTS[pm] || PM_OPTS.npm;
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if (!w.startsWith('-')) return { sub: w.replace(/^['"]+|['"]+$/g, ''), bad: null };
    const name = w.split('=')[0]; // `--opt=value` is a single word
    if (opts.value.has(name)) { if (name === w) i++; continue; } // `--opt value` consumes the next word
    if (!opts.bool.has(name)) return { sub: null, bad: w };
  }
  return { sub: null, bad: null };
}

/** Reason string when `entry` may never be allowed, else null. */
function toolProblem(entry) {
  if (typeof entry !== 'string') return 'must be a string';
  const m = /^([A-Za-z]+)(?:\(([\s\S]*)\))?$/.exec(entry.trim());
  if (!m || entry !== entry.trim()) return 'is not a valid tool pattern';
  const [, tool, arg] = m;
  if (tool !== 'Bash') return PLAIN_TOOLS.has(tool) && arg === undefined ? null : `tool "${entry}" is not allowed (only ${[...PLAIN_TOOLS].join('/')} and scoped Bash)`;
  if (arg === undefined) return 'bare Bash is not allowed';
  const prefix = arg.endsWith(':*') ? arg.slice(0, -2) : arg;
  if (prefix.trim() === '' || prefix !== prefix.trimStart()) return 'wildcard Bash is not allowed';
  if (prefix.includes('*') || SHELL_META.test(prefix)) return 'Bash pattern must be a plain command prefix';
  const words = prefix.trim().split(/\s+/);
  if (ENV_ASSIGNMENT.test(words[0].replace(/^['"]+/, ''))) return 'a leading VAR=value assignment can smuggle env into any command';
  const first = words[0].replace(/^['"]+|['"]+$/g, '').split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();
  if (FORBIDDEN_FIRST_WORDS.has(first) || VERSIONED_INTERPRETER.test(first)) return `Bash(${words[0]} ...) can run arbitrary code`;
  if (PM_EXEC_SUBS[first]) {
    const { sub, bad } = pmSubcommand(words.slice(1), first);
    if (bad) return `${first}: option ${JSON.stringify(bad)} before the subcommand is not recognised (it may hide exec/dlx); put the subcommand first`;
    if (sub && PM_EXEC_SUBS[first].includes(sub.toLowerCase())) return `${first} ${sub} downloads and runs arbitrary code`;
  }
  if (first === 'git') {
    if (words.length < 2 || words[1].startsWith('-')) return 'Bash(git ...) needs an explicit subcommand';
    if (!ALLOWED_GIT_SUBS.has(words[1])) return `git ${words[1]} is not allowed (git allowlist: ${[...ALLOWED_GIT_SUBS].join(', ')})`;
  }
  return null;
}

/** Split "A Bash(git add:*) B" into tokens; whitespace inside parentheses is kept. */
function tokenizeTools(str) {
  const out = [];
  let cur = '', depth = 0;
  for (const ch of String(str)) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (/\s/.test(ch) && depth === 0) { if (cur) out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function assertSafeEntries(list, where) {
  list.forEach((e) => {
    const p = toolProblem(e);
    if (p) throw usageError(`${where}: ${JSON.stringify(e)} ${p}`);
  });
}

/** baseline + registry tools (registry entries are held to the same rules). */
function permittedSet(registryTools = []) {
  assertSafeEntries(registryTools, 'registry allowedTools');
  return [...new Set([...BASELINE, ...registryTools])];
}

/** Orchestrator: effective list. `requested` (string "A B" or null) may only narrow. */
function resolveAllowedTools(requested, registryTools = []) {
  const permitted = permittedSet(registryTools);
  if (requested === null || requested === undefined) return permitted;
  const want = tokenizeTools(requested);
  if (!want.length) throw usageError('--allowed-tools is empty');
  assertSafeEntries(want, '--allowed-tools');
  const extra = want.find((e) => !permitted.includes(e));
  if (extra) throw usageError(`--allowed-tools may only narrow the policy; ${JSON.stringify(extra)} is not in baseline + registry allowedTools`);
  return [...new Set(want)];
}

/** Worker: spec.agent.allowedTools must be safe and inside baseline + target registry tools. */
function validateAllowedTools(list, registryTools = []) {
  assertSafeEntries(list, 'agent.allowedTools');
  const permitted = permittedSet(registryTools);
  const extra = list.find((e) => !permitted.includes(e));
  if (extra) throw usageError(`agent.allowedTools: ${JSON.stringify(extra)} is outside the policy (baseline + registry allowedTools)`);
  return list;
}

module.exports = { BASELINE, ALWAYS_DISALLOWED, toolProblem, tokenizeTools, resolveAllowedTools, validateAllowedTools };
