/**
 * verify-command-detector.cjs - decides whether a Bash command is a "verification" command
 * (test / build / typecheck / lint run) for the verify-completion-guard Stop hook.
 *
 * Detection is anchored to the COMMAND WORD of each segment (via the shared bash tokenizer, which
 * strips sudo/env/timeout/... prefixes), so `echo "npm test"`, `grep test` and
 * `git commit -m "npm test"` never count. A chain ending in `|| true`, `; true`, `|| :` or
 * `|| exit 0` is "masked": its exit status says nothing, so it does not count either.
 * Known limit: `npm test | tail` reports tail's exit status, which this module cannot see.
 *
 * Exports:
 *   detectVerifyCommand(command, {projectDir, cwd, extraPatterns}) -> {isVerify, masked, label}
 *   detectPackageManager(projectDir) -> 'bun'|'pnpm'|'yarn'|'npm'|null  (lockfiles under projectDir)
 *   hasPackageScript(projectDir, name) -> boolean
 */
const fs = require('fs');
const path = require('path');
const { tokenize, commandName } = require('./bash-command-segment-tokenizer.cjs');
const { regexTestWithTimeout } = require('./regex-test-with-timeout.cjs');

const MAX_COMMAND_CHARS = 2000; // cap before regex work (also bounds user-supplied patterns)
const MAX_PACKAGE_JSON_BYTES = 1024 * 1024;

// package.json script names that count as verification (whole token, optional `:suffix`/`-suffix`).
const SCRIPT_RE = /^(test|spec|build|lint|typecheck|type-check|check|verify|e2e|ci)([:-].*)?$/;
// Operators after a verify segment that stop the command's exit status from reflecting it:
// `;` / newline (when something runs after), `||`, `|` (pipe status is the last stage's), `&` (backgrounded).
const MASKING_OPS_ALWAYS = new Set(['||', '|', '&']);
const MASKING_OPS_IF_MORE = new Set([';', '\n']);

const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const LOCKFILES = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
];
// Package-manager flags that consume the next word (so it is not mistaken for the script name).
const PM_VALUE_FLAGS = new Set(['--filter', '-F', '--prefix', '-C', '--workspace', '-w', '--cwd', '--dir']);
const NPX_VALUE_FLAGS = new Set(['-p', '--package', '-c', '--call']);
const NPX_RUNNERS = new Set(['npx', 'bunx']);
// Tools that verify on any invocation (first arg rules below where noted).
const DIRECT_TOOLS = new Set(['tsc', 'vitest', 'jest', 'eslint', 'biome', 'pytest', 'mypy', 'tox', 'phpunit', 'rspec']);

function isFlag(word) {
  return word.startsWith('-');
}

/** Words after argv[0] with flags (and the value of known value-flags) removed. */
function positional(args, valueFlags) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const w = args[i];
    if (valueFlags.has(w)) {
      i += 1;
    } else if (!isFlag(w)) {
      out.push(w);
    }
  }
  return out;
}

const packageJsonCache = new Map();

/** Parsed package.json `scripts` of <dir>, or {} (cached per process; the hook is short-lived). */
function readScripts(dir) {
  if (!dir) return {};
  const file = path.join(dir, 'package.json');
  if (packageJsonCache.has(file)) return packageJsonCache.get(file);
  let scripts = {};
  try {
    if (fs.statSync(file).size <= MAX_PACKAGE_JSON_BYTES) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed.scripts === 'object' && parsed.scripts) scripts = parsed.scripts;
    }
  } catch {
    scripts = {};
  }
  packageJsonCache.set(file, scripts);
  return scripts;
}

function hasPackageScript(projectDir, name) {
  return Object.prototype.hasOwnProperty.call(readScripts(projectDir), name);
}

/** Package manager named by a lockfile under projectDir, else null. */
function detectPackageManager(projectDir) {
  if (!projectDir) return null;
  for (const [file, pm] of LOCKFILES) {
    try {
      if (fs.existsSync(path.join(projectDir, file))) return pm;
    } catch {
      // unreadable dir: keep looking / give up quietly
    }
  }
  return null;
}

/** `<pm> test` / `<pm> run <script>` / `yarn|pnpm <script>` / `bun test`. */
function matchPackageManager(name, args, dirs) {
  const words = positional(args, PM_VALUE_FLAGS);
  if (words.length === 0) return false;
  let script = words[0];
  if (script === 'run' || script === 'run-script') {
    script = words[1];
  } else if (script === 'test' || script === 't' || script === 'tst') {
    return true; // `<pm> test` is always the test script
  } else if (name === 'npm' || name === 'bun') {
    return false; // `npm install`, `bun add`, ... only `test`/`run <script>` count
  }
  if (!script || !SCRIPT_RE.test(script)) return false;
  return dirs.some((d) => hasPackageScript(d, script));
}

/** `make test` etc: a target is required, `make clean` / bare `make` do not count. */
function matchMake(args) {
  const target = args.filter((w) => !isFlag(w) && !w.includes('='))[0];
  return ['test', 'check', 'build', 'lint', 'verify'].includes(target);
}

/** True when argv (prefix-stripped) is a verification command. */
function matchSegment(argv, dirs) {
  const name = commandName({ argv });
  const args = argv.slice(1);
  const first = args.find((w) => !isFlag(w));
  const base = (w) => path.posix.basename(String(w).replace(/\\/g, '/'));

  if (name === 'node' || name === 'nodejs') {
    return args.some(
      (w) => w === '--test' || /\.(test|spec)\.(cjs|mjs|js|ts)$/.test(w) || /^run-[\w-]*tests?\.cjs$/.test(base(w))
    );
  }
  if (NPX_RUNNERS.has(name) || (name === 'pnpm' && ['dlx', 'exec'].includes(first)) || (name === 'yarn' && first === 'dlx')) {
    const rest = NPX_RUNNERS.has(name) ? args : args.slice(args.indexOf(first) + 1);
    const words = positional(rest, NPX_VALUE_FLAGS);
    return words.length > 0 && matchSegment(words, dirs);
  }
  if (PACKAGE_MANAGERS.has(name)) return matchPackageManager(name, args, dirs);
  if (name === 'tsc') return !args.includes('--init');
  if (name === 'biome') return ['check', 'lint', 'ci'].includes(first);
  if (name === 'playwright') return first === 'test';
  if (DIRECT_TOOLS.has(name)) return true;
  if (name === 'ruff') return first !== 'format';
  if (name === 'python' || name === 'python3') {
    const m = args.indexOf('-m');
    return m >= 0 && ['pytest', 'unittest', 'mypy'].includes(args[m + 1]);
  }
  if (name === 'go') return ['test', 'build', 'vet'].includes(first);
  if (name === 'cargo') return ['test', 'build', 'check', 'clippy'].includes(first);
  if (name === 'make') return matchMake(args);
  if (['mvn', 'mvnw', 'gradle', 'gradlew'].includes(name)) return args.some((w) => ['test', 'build', 'check', 'verify'].includes(w));
  if (name === 'dotnet' || name === 'swift') return ['test', 'build', 'check', 'verify'].includes(first);
  if (name === 'flutter') return first === 'test';
  if (name === 'php') return first === 'artisan' && args.includes('test');
  if (name === 'deno') return ['test', 'check', 'lint'].includes(first);
  return false;
}

/** `exit` / `exit $?` / `exit <nonzero>`: a tail after `||` that keeps the failure. */
function isFailureKeepingExit(seg) {
  if (!seg || !seg.argv || seg.argv[0] !== 'exit') return false;
  const code = seg.argv[1];
  return code === undefined || code === '$?' || (/^\d+$/.test(code) && Number(code) !== 0);
}

/** `|| exit 1`, `|| exit $?`, `|| { echo x; exit 1; }`: the segments from `from` (to the group's `}`) exit non-zero. */
function failureTailFollows(segments, from) {
  for (let j = from; j < segments.length; j += 1) {
    if (isFailureKeepingExit(segments[j])) return true;
    if (segments[j].argv && segments[j].argv[0] === '}') return false;
  }
  return false;
}

/**
 * True when the verify segment at `idx` cannot decide the command's exit status: negated (`! cmd`),
 * piped, backgrounded, followed by `||` (unless it only leads to a failing exit) or by more commands
 * after `;`. `; exit $?` right after, `&&` chains and a trailing `;` do not mask.
 */
function isMasked(segments, idx) {
  if (/^!\s/.test(segments[idx].raw || '')) return true;
  for (let k = idx; k < segments.length; k += 1) {
    const op = segments[k].op;
    if (op === '||') return !failureTailFollows(segments, k + 1);
    if (MASKING_OPS_ALWAYS.has(op)) return true;
    if (MASKING_OPS_IF_MORE.has(op) && k < segments.length - 1) {
      const next = segments[k + 1];
      if (next.argv && next.argv[0] === 'exit' && (next.argv[1] === undefined || next.argv[1] === '$?')) return false;
      return true;
    }
  }
  return false;
}

/**
 * @param {string} command Bash tool command text
 * @param {{projectDir?: string, cwd?: string, extraPatterns?: RegExp[]}} [opts]
 * @returns {{isVerify: boolean, masked: boolean, patternTimeout: boolean, label: string}}
 */
function detectVerifyCommand(command, opts = {}) {
  const none = { isVerify: false, masked: false, patternTimeout: false, label: '' };
  if (typeof command !== 'string' || command.trim() === '') return none;
  const text = command.slice(0, MAX_COMMAND_CHARS);
  const baseCwd = opts.cwd || opts.projectDir || process.cwd();
  let segments;
  try {
    segments = tokenize(text, { cwd: baseCwd });
  } catch {
    return none;
  }
  const extra = Array.isArray(opts.extraPatterns) ? opts.extraPatterns : [];
  // Every verify segment must be unmasked: `npm test; npm run lint` hides the test status behind lint.
  const hits = [];
  let patternTimeout = false;
  segments.forEach((seg, idx) => {
    if (!seg.argv || seg.argv.length === 0) return;
    const dirs = [seg.cwd, opts.projectDir].filter(Boolean);
    let hit = matchSegment(seg.argv, dirs);
    for (const re of hit ? [] : extra) {
      // user patterns run under a vm timeout (ReDoS); a timeout means "does not match"
      const run = regexTestWithTimeout(re.source, re.flags, seg.argv.join(' ').slice(0, MAX_COMMAND_CHARS));
      if (!run.ok && run.reason === 'timeout') patternTimeout = true;
      if (run.ok && run.matched) {
        hit = true;
        break;
      }
    }
    if (hit) hits.push(idx);
  });
  if (hits.length > 0) {
    const maskedIdx = hits.find((idx) => isMasked(segments, idx));
    const shown = maskedIdx === undefined ? hits[hits.length - 1] : maskedIdx;
    return { isVerify: true, masked: maskedIdx !== undefined, patternTimeout, label: segments[shown].argv.slice(0, 5).join(' ').slice(0, 80) };
  }
  none.patternTimeout = patternTimeout;
  return none;
}

module.exports = { detectVerifyCommand, detectPackageManager, hasPackageScript, SCRIPT_RE };
