/**
 * bash-secret-file-read-rule.cjs - rule `secret-file-read`.
 *
 * settings.json `permissions.ask` prompts for `Read(**\/.env)` & co, but `cat .env`, `grep KEY .env`,
 * `source .env`, `cp id_rsa /tmp` or `curl -F f=@.env` never reach the Read tool. This rule closes
 * that gap for common Bash readers. Decision: ask only (never deny); the rule is a seatbelt, not a sandbox.
 *
 *   ask  a reader (cat less head tail bat grep rg awk sed xxd base64 strings source . cp scp rsync
 *        curl ...) is given a secret path, or a segment redirects input from one (`< .env`)
 *   ask  opaque segments (`$(...)`, backticks, heredocs) when a secret path appears literally in them
 *   allow templates (.env.example / .sample / .template), `cp .env.example .env` (only cp SOURCES count),
 *        the pattern word of grep/rg/sed/awk (`grep .env README.md`), commands that merely mention a name
 *        (`ls .env`, `echo .env`, `git add .env.example`)
 *
 * Secret path set: the union of a built-in fallback list and the `Read(...)` entries of `permissions.ask` in the
 * settings.json that sits next to the hooks directory (entries are normalised: `~/`, `//abs`, `/x`, `./x`, bare
 * names and `{a,b}` braces). Heredoc bodies are text, not commands, and are skipped.
 * Known limits (not chased): interpreters (`python -c open('.env')`, perl), `find -exec cat`, `xargs`, editors,
 * `grep -r KEY .` over a directory, `git diff`/`git log -p` of a secret, `curl -K`, variables other than a
 * leading $HOME, brace expansion, `[..]` glob classes. `.pub` keys ask (parity with the Read rule); `sed -i` asks.
 *
 * Contract: opaquePolicy 'inspect', crashPolicy 'allow'. Reasons name the file, never file contents.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { commandName, expandHome, skipHeredocBodies, readHeredocDelimiter } = require('./bash-command-segment-tokenizer.cjs');

const FALLBACK_GLOBS = [
  '**/.env', '**/.env.local', '**/.env.*.local', '**/*.pem', '**/*.key', '**/id_rsa*', '**/id_ed25519*',
];
// Representative secret basenames, used to decide whether a shell glob argument (`.env*`) could hit one.
const SAMPLE_NAMES = [
  '.env', '.env.local', '.env.production', '.env.development', '.env.test', '.env.staging', '.env.prod.local',
  'server.pem', 'server.key', 'cert.p12', 'cert.pfx', 'id_rsa', 'id_rsa.pub', 'id_ed25519', 'secrets.yml', 'secret.yaml',
  'aws-credentials.json',
];
const TEMPLATE_SUFFIX = /\.(example|sample|template)$/i;
const GLOB_CHARS = /[*?]/;

// Option tables: pattern = first positional is a pattern/script; patternShort/fileShort = letters of -e/-f style
// options; valueShort/valueLong = options that swallow a value; fileLong = long options whose value is a file.
const GREP = { pattern: true, patternShort: 'e', fileShort: 'f', valueShort: 'ABCmgtTdDjM', patternLong: ['regexp'], fileLong: ['file'], valueLong: ['max-count', 'after-context', 'before-context', 'context', 'glob', 'type'] };
const CMDS = {
  cat: {}, tac: {}, nl: {}, less: {}, more: {}, head: {}, tail: {}, bat: {}, batcat: {}, xxd: {}, od: {}, hexdump: {},
  base64: {}, strings: {}, cut: {}, sort: {}, diff: {}, source: {}, '.': {},
  grep: GREP, egrep: GREP, fgrep: GREP, rg: GREP,
  sed: { pattern: true, patternShort: 'e', fileShort: 'f', valueShort: 'l', patternLong: ['expression'], fileLong: ['file'] },
  awk: { pattern: true, fileShort: 'f', valueShort: 'vF', fileLong: ['file'] },
  gawk: { pattern: true, fileShort: 'f', valueShort: 'vF', fileLong: ['file'] },
  cp: { copy: true, valueShort: 'tS', valueLong: ['suffix'], targetDirShort: 't', targetDirLong: 'target-directory' },
  scp: { copy: true, valueShort: 'PiosFcl' },
  rsync: { copy: true, valueShort: 'ef', valueLong: ['exclude', 'include', 'filter', 'rsh'] },
  curl: { curl: true },
  jq: { pattern: true, fileShort: 'f', fileLong: ['from-file'] },
  yq: { pattern: true, fileShort: 'f', fileLong: ['from-file'] },
  paste: {}, column: {},
  dd: { dd: true },
  openssl: { openssl: true },
  git: { git: true },
};

let cachedMatchers = null;

/** Glob (`**`, `*`, `?`) -> anchored RegExp. `**\/` also matches zero directories. */
function globToRegex(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 'i');
}

/** Expands `{a,b}` alternatives (nested, left to right) into separate globs. */
function expandBraces(glob) {
  const open = glob.indexOf('{');
  if (open === -1) return [glob];
  let depth = 0;
  let close = -1;
  const parts = [];
  let last = open + 1;
  for (let i = open; i < glob.length; i += 1) {
    if (glob[i] === '{') depth += 1;
    else if (glob[i] === '}') {
      depth -= 1;
      if (depth === 0) { close = i; break; }
    } else if (glob[i] === ',' && depth === 1) {
      parts.push(glob.slice(last, i));
      last = i + 1;
    }
  }
  if (close === -1) return [glob];
  parts.push(glob.slice(last, close));
  const head = glob.slice(0, open);
  const tail = glob.slice(close + 1);
  return parts.flatMap((p) => expandBraces(`${head}${p}${tail}`));
}

/**
 * Claude Code path forms -> a glob over absolute, forward-slash paths:
 * `~/x` home, `//x` absolute, `/x` relative to the settings root, `./x` and bare `x` anywhere in the tree.
 */
function normalizeGlob(entry, settingsRoot) {
  const home = os.homedir().replace(/\\/g, '/');
  const root = String(settingsRoot || '').replace(/\\/g, '/');
  let g = String(entry).trim().replace(/\\/g, '/');
  if (g.startsWith('~/')) g = `${home}/${g.slice(2)}`;
  else if (g.startsWith('//')) g = g.slice(1);
  else if (g.startsWith('/')) g = root ? `${root}${g}` : `**${g}`;
  else if (g.startsWith('./')) g = `**/${g.slice(2)}`;
  else if (!g.startsWith('**') && !/^[A-Za-z]:\//.test(g)) g = `**/${g}`;
  return g;
}

/**
 * Secret globs: fallback list plus the `Read(...)` ask entries of `settingsPath` (default: the settings.json next
 * to the hooks dir). Always a union, so a user file with only unrelated entries never switches protection off.
 */
function loadSecretGlobs(settingsPath) {
  const file = settingsPath || path.join(__dirname, '..', '..', 'settings.json');
  const globs = [...FALLBACK_GLOBS];
  try {
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    const ask = settings && settings.permissions && settings.permissions.ask;
    const root = path.dirname(path.dirname(path.resolve(file))); // settings.json lives in <root>/.claude/
    for (const entry of Array.isArray(ask) ? ask : []) {
      const m = /^Read\((.+)\)$/.exec(String(entry));
      if (m) globs.push(...expandBraces(normalizeGlob(m[1], root)));
    }
  } catch {
    // unreadable settings: the fallback list stands alone
  }
  return [...new Set(globs)];
}

function matchers() {
  if (!cachedMatchers) cachedMatchers = loadSecretGlobs().map(globToRegex);
  return cachedMatchers;
}

/** Absolute forward-slash path; keeps drive-letter / rooted paths intact (no process.cwd() prefixing on Windows). */
function absolutize(cwd, p) {
  const isAbs = (x) => x.startsWith('/') || /^[A-Za-z]:\//.test(x);
  if (isAbs(p)) return path.posix.normalize(p);
  const base = isAbs(cwd) ? cwd : '/';
  return path.posix.normalize(`${base}/${p}`);
}

/** True when `text` (a path word) names a secret file. Dynamic words with glob chars are tested against sample names. */
function isSecretPath(text, dynamic, cwd) {
  if (!text || text.length > 1024) return false;
  // A leading $HOME / ${HOME} is the one variable we can resolve.
  const home = text.replace(/^(?:\$HOME|\$\{HOME\})(?=[/\\]|$)/, () => os.homedir());
  if (/[$`{}]/.test(home)) return false;
  const unified = home.replace(/\\/g, '/');
  const base = path.posix.basename(unified);
  if (TEMPLATE_SUFFIX.test(base)) return false;
  if (dynamic && GLOB_CHARS.test(base)) {
    if (/^[*?]+$/.test(base)) return false; // `*` alone would flag every `cat *`
    const re = globToRegex(base);
    return SAMPLE_NAMES.some((name) => re.test(name));
  }
  const resolved = absolutize(String(cwd || '/').replace(/\\/g, '/'), expandHome(unified).replace(/\\/g, '/'));
  return matchers().some((re) => re.test(resolved));
}

/**
 * Words of a raw segment with quotes removed, split on unquoted whitespace and shell operators.
 * Words that are targets of an output redirection (`> f`, `>> f`, `&> f`) are dropped; with
 * `inputOnly` only targets of `<` are returned.
 */
function rawWords(raw, inputOnly) {
  const words = [];
  let cur = null;
  let quote = '';
  let afterOutput = false;
  let afterInput = false;
  const heredocs = []; // pending heredoc delimiters, bodies start after the next newline
  const parens = []; // true for `$(` openers
  let inTick = false;
  const flush = () => {
    if (cur !== null) {
      if (inputOnly ? afterInput : !afterOutput) words.push(cur);
      if (cur !== '') {
        afterOutput = false;
        afterInput = false;
      }
    }
    cur = null;
  };
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i];
    if (quote) {
      if (c === quote) quote = '';
      else if (quote === '"' && c === '\\' && i + 1 < raw.length) { i += 1; cur += raw[i]; }
      else cur += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      if (cur === null) cur = '';
    } else if (c === '\\' && i + 1 < raw.length) {
      i += 1;
      cur = (cur || '') + raw[i];
    } else if (c === '<' || c === '>') {
      flush();
      if (c === '<' && raw[i + 1] === '<' && raw[i + 2] !== '<') {
        const dash = raw[i + 2] === '-';
        const { delim, end } = readHeredocDelimiter(raw, i + (dash ? 3 : 2));
        heredocs.push({ delim, dash });
        i = end - 1;
        afterInput = false;
      } else if (raw[i + 1] === '<' || raw[i + 1] === '(' || raw[i + 1] === '&') {
        while (raw[i + 1] === '<') i += 1; // here-string / process substitution: not a file read
        afterInput = false;
      } else if (c === '<') {
        afterInput = true;
      } else {
        afterOutput = true;
        afterInput = false;
      }
    } else if (c === '\n' && heredocs.length > 0) {
      flush();
      i = skipHeredocBodies(raw, i + 1, heredocs.splice(0)) - 1; // heredoc bodies are text, not words
    } else if (c === '(') {
      const subst = cur === '$';
      parens.push(subst);
      flush();
    } else if (c === ')') {
      flush();
      // Text glued to a command substitution (`$(pwd)/.env`) is not a literal path: poison the word.
      if (parens.pop()) cur = '$';
    } else if (c === '`') {
      flush();
      inTick = !inTick;
      if (!inTick) cur = '$';
    } else if (/[\s;&|]/.test(c)) {
      flush();
    } else {
      cur = (cur || '') + c;
    }
  }
  flush();
  return words;
}

/** Splits args into option-free positionals plus file-valued options, per the option table `cfg`. */
function scanArgs(args, dynamic, cfg) {
  const positionals = [];
  const files = [];
  let patternPending = Boolean(cfg.pattern);
  let targetDir = false;
  let end = false;
  const entry = (i) => ({ text: args[i], dynamic: Boolean(dynamic[i]) });
  const valueOf = (i, attached) => {
    if (attached !== null && attached !== '') return { text: attached, dynamic: Boolean(dynamic[i]) };
    return i + 1 < args.length ? entry(i + 1) : null;
  };
  for (let i = 0; i < args.length; i += 1) {
    const t = args[i];
    if (end || t === '-' || t[0] !== '-') {
      positionals.push(entry(i));
    } else if (t === '--') {
      end = true;
    } else if (t.startsWith('--')) {
      const eq = t.indexOf('=');
      const name = (eq === -1 ? t.slice(2) : t.slice(2, eq));
      const attached = eq === -1 ? null : t.slice(eq + 1);
      const takes = (list) => Array.isArray(list) && list.includes(name);
      if (takes(cfg.fileLong)) {
        const v = valueOf(i, attached);
        if (v) files.push(v);
        patternPending = false;
        if (attached === null) i += 1;
      } else if (takes(cfg.patternLong)) {
        patternPending = false;
        if (attached === null) i += 1;
      } else if (takes(cfg.valueLong) || name === cfg.targetDirLong) {
        if (name === cfg.targetDirLong) targetDir = true;
        if (attached === null) i += 1;
      }
    } else {
      for (let k = 1; k < t.length; k += 1) {
        const ch = t[k];
        const rest = t.slice(k + 1);
        if (cfg.fileShort && ch === cfg.fileShort) {
          const v = valueOf(i, rest);
          if (v) files.push(v);
          patternPending = false;
          if (rest === '') i += 1;
          break;
        }
        if (cfg.patternShort && ch === cfg.patternShort) {
          patternPending = false;
          if (rest === '') i += 1;
          break;
        }
        if (cfg.valueShort && cfg.valueShort.includes(ch)) {
          if (ch === cfg.targetDirShort) targetDir = true;
          if (rest === '') i += 1;
          break;
        }
      }
    }
  }
  if (patternPending && positionals.length > 0) positionals.shift();
  return { positionals, files, targetDir };
}

/** curl uploads: `-F f=@.env`, `-d @.env`, `--data-binary @.env`, `-T .env`, `--upload-file .env`. */
function curlCandidates(args, dynamic) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const t = args[i];
    const d = Boolean(dynamic[i]);
    if (t === '-T' || t === '--upload-file') {
      if (i + 1 < args.length) out.push({ text: args[i + 1], dynamic: Boolean(dynamic[i + 1]) });
      i += 1;
    } else if (t.startsWith('--upload-file=')) {
      out.push({ text: t.slice('--upload-file='.length), dynamic: d });
    } else if (/^-T./.test(t) && !t.startsWith('--')) {
      out.push({ text: t.slice(2), dynamic: d });
    } else {
      const m = /(?:^|=|^-[a-zA-Z])[@<]([^;]+)/.exec(t);
      if (m) out.push({ text: m[1], dynamic: d });
    }
  }
  return out;
}

/** `dd if=FILE`, `openssl ... -in FILE`. */
function keyValueCandidates(cfg, args, dynamic) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const d = Boolean(dynamic[i]);
    if (cfg.dd && args[i].startsWith('if=')) out.push({ text: args[i].slice(3), dynamic: d });
    if (cfg.openssl && args[i] === '-in' && i + 1 < args.length) out.push({ text: args[i + 1], dynamic: Boolean(dynamic[i + 1]) });
  }
  return out;
}

/** `git show|cat-file` operands of the form `<rev>:<path>` or `:<path>`. */
function gitCandidates(args, dynamic) {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) i += /^-[Cc]$/.test(args[i]) ? 2 : 1; // global options
  if (args[i] !== 'show' && args[i] !== 'cat-file') return [];
  const out = [];
  for (let k = i + 1; k < args.length; k += 1) {
    if (args[k].startsWith('-')) continue;
    const m = /^[^:\s]*:(.+)$/.exec(args[k]);
    if (m) out.push({ text: m[1], dynamic: Boolean(dynamic[k]) });
  }
  return out;
}

/** Path words a reader command would open, from its argv (argv[0] excluded). */
function readCandidates(name, argv, dynamicFlags) {
  const cfg = CMDS[name];
  const args = argv.slice(1);
  const dyn = (dynamicFlags || []).slice(1);
  if (cfg.curl) return curlCandidates(args, dyn);
  if (cfg.dd || cfg.openssl) return keyValueCandidates(cfg, args, dyn);
  if (cfg.git) return gitCandidates(args, dyn);
  const { positionals, files, targetDir } = scanArgs(args, dyn, cfg);
  let sources = positionals;
  if (cfg.copy && !targetDir && positionals.length > 1) sources = positionals.slice(0, -1); // the last word is the destination
  // scp/rsync remote operands (`host:path`): drop the host part.
  const stripHost = (e) => (cfg.copy && name !== 'cp' ? { ...e, text: e.text.replace(/^[^/:]*:/, '') } : e);
  return [...files, ...sources.map(stripHost)];
}

function ask(reason) {
  return { decision: 'ask', reason, context: reason };
}

function askFor(file, how) {
  const shown = file.length > 80 ? `${file.slice(0, 77)}...` : file;
  return ask(`${how} secret file '${shown}' (a Read ask-rule path). Confirm it is intended, or read only the keys you need; templates like .env.example are not flagged.`);
}

function check(segment, ctx) {
  const cwd = segment.cwd || ctx.cwd;
  const raw = segment.raw || '';

  // Input redirection from a secret file, whatever the command is.
  for (const target of rawWords(raw, true)) {
    if (isSecretPath(target, false, cwd)) return askFor(target, 'Redirecting input from');
  }

  if (segment.opaque) {
    // Cannot model it: ask only when a secret path shows up literally.
    for (const word of rawWords(raw, false)) {
      if (isSecretPath(word, false, cwd)) return askFor(word, 'Command may read');
    }
    return null;
  }

  const name = commandName(segment);
  if (!Object.prototype.hasOwnProperty.call(CMDS, name)) return null;
  for (const candidate of readCandidates(name, segment.argv, segment.dynamic)) {
    if (isSecretPath(candidate.text, candidate.dynamic, cwd)) return askFor(candidate.text, `\`${name}\` would read or copy`);
  }
  return null;
}

module.exports = {
  id: 'secret-file-read',
  configKey: 'secretFileRead',
  opaquePolicy: 'inspect',
  crashPolicy: 'allow',
  check,
  // exported for tests
  loadSecretGlobs,
  normalizeGlob,
  expandBraces,
  globToRegexForTests: globToRegex,
};
