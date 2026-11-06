'use strict';
/**
 * Minimal YAML-frontmatter reader/editor for plan files. Handles CRLF,
 * scalars, quoted strings, inline [a, b] lists and block lists. Editing
 * rewrites one scalar line; every other byte of the file is preserved.
 */

const FM_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function unquote(v) {
  const s = v.trim();
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    return s[0] === '"' ? s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\') : s.slice(1, -1).replace(/''/g, "'");
  }
  return s.replace(/\s+#.*$/, ''); // trailing comment on plain scalars
}

function splitInline(inner) {
  const out = [];
  let cur = '', quote = null;
  for (const ch of inner) {
    if (quote) { cur += ch; if (ch === quote) quote = null; }
    else if (ch === '"' || ch === "'") { quote = ch; cur += ch; }
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur.trim() !== '') out.push(cur);
  return out.map(unquote);
}

/** @returns {Object<string, string|string[]>} empty object when no frontmatter. */
function parseFrontmatter(text) {
  const m = FM_RE.exec(String(text).replace(/\r/g, ''));
  if (!m) return {};
  const lines = m[1].split('\n');
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    const km = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(lines[i]);
    if (!km) continue;
    const [, key, rawVal] = km;
    const val = rawVal.trim();
    if (val === '') { // possible block list
      const items = [];
      while (i + 1 < lines.length && /^[ \t]*-[ \t]+/.test(lines[i + 1])) {
        items.push(unquote(lines[++i].replace(/^[ \t]*-[ \t]+/, '')));
      }
      out[key] = items.length ? items : '';
    } else if (val.startsWith('[') && val.endsWith(']')) {
      out[key] = splitInline(val.slice(1, -1));
    } else {
      out[key] = unquote(val);
    }
  }
  return out;
}

const needsQuote = (v) => v === '' || /^[\s'"[\]{}>|*&!%@`#,-]|[:#]\s|\s$/.test(v) || /^(true|false|null|~|yes|no)$/i.test(v);
const fmtScalar = (v) => {
  const s = String(v);
  if (/[\r\n]/.test(s)) throw new Error('frontmatter value must be single-line');
  return needsQuote(s) ? JSON.stringify(s) : s;
};

/**
 * Set (or add) a top-level scalar key; body and other lines stay byte-identical.
 * Throws when the file has no frontmatter block.
 */
function setFrontmatterScalar(text, key, value) {
  if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new Error(`invalid frontmatter key ${JSON.stringify(key)}`);
  const m = FM_RE.exec(text);
  if (!m) throw new Error('no frontmatter block');
  const eol = m[0].includes('\r\n') ? '\r\n' : '\n';
  const start = m[0].indexOf(m[1]); // block starts right after the opening fence
  const block = m[1];
  const lineRe = new RegExp(`^${key}:[ \\t]*.*$`, 'm');
  const lineRaw = lineRe.exec(block);
  let newBlock;
  if (lineRaw) {
    // Keep a trailing \r (CRLF) out of the match: `.` matches \r, so strip it back in.
    const cr = lineRaw[0].endsWith('\r') ? '\r' : '';
    newBlock = block.slice(0, lineRaw.index) + `${key}: ${fmtScalar(value)}${cr}` + block.slice(lineRaw.index + lineRaw[0].length);
  } else {
    newBlock = `${block}${eol}${key}: ${fmtScalar(value)}`;
  }
  return text.slice(0, start) + newBlock + text.slice(start + block.length);
}

module.exports = { parseFrontmatter, setFrontmatterScalar };
