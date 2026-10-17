'use strict';
/**
 * Minimal tokenizer for git's config grammar (config.c: git_parse_source / get_base_var / get_extended_base_var /
 * get_value / parse_value), used only to collect `path` values of `[include]` / `[includeIf "..."]` sections.
 *  - Section headers: `[name]`, `[name "sub"]` (quote-aware, `\x` escapes), legacy `[name.sub]`; the rest of the
 *    header line is parsed as the next entry (`[include] path = x`).
 *  - `key = value`; values: `"` quoting, escapes `\\ \" \n \t \b`, backslash-newline continuation ONLY inside a
 *    value (never inside comments), unquoted `;`/`#` starts a comment that runs to end of line.
 *  - CRLF counts as LF; a leading BOM is skipped; end of input acts as a final newline.
 *  - Where git reports an error it refuses the whole file; here we skip the rest of that line and keep going,
 *    which can only over-approximate (collect more paths) - never fewer. Never throws.
 * Section name matching is deliberately loose (any subsection / legacy form counts): more files hashed, never fewer.
 */

const ERR = Symbol('git-config-syntax-error');
const isSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
const isAlpha = (c) => /^[A-Za-z]$/.test(c);
const isKeyChar = (c) => /^[A-Za-z0-9-]$/.test(c);
const VALUE_ESCAPES = { t: '\t', b: '\b', n: '\n', '\\': '\\', '"': '"' };

/** Raw `path` values (unresolved, unexpanded) of include / includeIf sections in config text. */
function includePathsOfText(text) {
  const s = `${String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n')}\n`;
  let i = 0;
  const next = () => (i < s.length ? s[i++] : (i++, '\n')); // past the end: endless newlines
  const found = [];
  let inInclude = false;
  let comment = false;

  /** After `[`: returns true for include / includeif sections. */
  function parseHeader() {
    let name = '';
    for (;;) {
      let c = next();
      if (c === ']') break;
      if (isSpace(c)) { // extended form: [name "sub"]
        do { if (c === '\n') throw ERR; c = next(); } while (isSpace(c));
        if (c !== '"') throw ERR;
        for (;;) {
          c = next();
          if (c === '\n') throw ERR;
          if (c === '"') break;
          if (c === '\\' && (c = next()) === '\n') throw ERR;
        }
        if (next() !== ']') throw ERR;
        break;
      }
      if (!isKeyChar(c) && c !== '.') throw ERR;
      name += c.toLowerCase();
    }
    const base = name.split('.')[0];
    return base === 'include' || base === 'includeif';
  }

  /** After `=`: git's parse_value. Consumes through the terminating newline. */
  function parseValue() {
    let out = '', quote = false, cmt = false, space = 0;
    for (;;) {
      let c = next();
      if (c === '\n') { if (quote) throw ERR; return out; }
      if (cmt) continue;
      if (isSpace(c) && !quote) { if (out) space++; continue; }
      if (!quote && (c === ';' || c === '#')) { cmt = true; continue; }
      out += ' '.repeat(space); space = 0;
      if (c === '\\') {
        c = next();
        if (c === '\n') continue; // continuation
        if (!(c in VALUE_ESCAPES)) throw ERR;
        out += VALUE_ESCAPES[c];
        continue;
      }
      if (c === '"') { quote = !quote; continue; }
      out += c;
    }
  }

  while (i < s.length) {
    const c = s[i++];
    if (c === '\n') { comment = false; continue; }
    if (comment || isSpace(c)) continue;
    if (c === '#' || c === ';') { comment = true; continue; }
    try {
      if (c === '[') { inInclude = false; inInclude = parseHeader(); continue; }
      if (!isAlpha(c)) throw ERR;
      let key = c.toLowerCase();
      let d = next();
      while (isKeyChar(d)) { key += d.toLowerCase(); d = next(); }
      while (d === ' ' || d === '\t') d = next();
      let value = null;
      if (d !== '\n') { if (d !== '=') throw ERR; value = parseValue(); }
      if (inInclude && key === 'path' && value) found.push(value);
    } catch (e) {
      if (e !== ERR) throw e;
      if (s[i - 1] !== '\n') { while (i < s.length && s[i] !== '\n') i++; } // resync at end of line
    }
  }
  return found;
}

module.exports = { includePathsOfText };
