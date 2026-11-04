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
 * Secret path set: the `Read(...)` entries of `permissions.ask` in the settings.json that sits next to the
 * hooks directory (single source of truth); a small fallback list is used when it is unreadable or has none.
 * Known limits (not chased): `python -c open('.env')`, `find -exec cat`, `grep -r KEY .` over a directory,
 * paths built from variables, brace expansion.
 *
 * Contract: opaquePolicy 'inspect', crashPolicy 'allow'. Reasons name the file, never file contents.
 */
const fs = require('fs');
const path = require('path');
const { commandName, expandHome } = require('./bash-command-segment-tokenizer.cjs');

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

/** `Read(...)` globs of settings.json `permissions.ask` next to the hooks dir, or the fallback list. */
function loadSecretGlobs() {
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'settings.json'), 'utf8'));
    const ask = settings && settings.permissions && settings.permissions.ask;
    const globs = (Array.isArray(ask) ? ask : [])
      .map((entry) => /^Read\((.+)\)$/.exec(String(entry)))
      .filter(Boolean)
      .map((m) => m[1]);
    if (globs.length > 0) return globs;
  } catch {
    // unreadable settings: use the fallback
  }
  return FALLBACK_GLOBS;
}

function matchers() {
  if (!cachedMatchers) cachedMatchers = loadSecretGlobs().map(globToRegex);
  return cachedMatchers;
}

/** True when `text` (a path word) names a secret file. Dynamic words with glob chars are tested against sample names. */
function isSecretPath(text, dynamic, cwd) {
  if (!text || /[$`{}]/.test(text) || text.length > 1024) return false;
  const unified = text.replace(/\\/g, '/');
  const base = path.posix.basename(unified);
  if (TEMPLATE_SUFFIX.test(base)) return false;
  if (dynamic && GLOB_CHARS.test(base)) {
    if (/^[*?]+$/.test(base)) return false; // `*` alone would flag every `cat *`
    const re = globToRegex(base);
    return SAMPLE_NAMES.some((name) => re.test(name));
  }
  const resolved = path.posix.resolve(String(cwd || '/').replace(/\\/g, '/'), expandHome(unified).replace(/\\/g, '/'));
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
      if (raw[i + 1] === '<' || raw[i + 1] === '(' || raw[i + 1] === '&') {
        while (raw[i + 1] === '<') i += 1; // heredoc / here-string / process substitution: not a file read
        afterInput = false;
      } else if (c === '<') {
        afterInput = true;
      } else {
        afterOutput = true;
        afterInput = false;
      }
    } else if (/[\s;&|()`]/.test(c)) {
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

/** Path words a reader command would open, from its argv (argv[0] excluded). */
function readCandidates(name, argv, dynamicFlags) {
  const cfg = CMDS[name];
  const args = argv.slice(1);
  const dyn = (dynamicFlags || []).slice(1);
  if (cfg.curl) return curlCandidates(args, dyn);
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
};
