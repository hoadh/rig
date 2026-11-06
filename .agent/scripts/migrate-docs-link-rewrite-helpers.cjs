/**
 * Link/path rewriting helpers for migrate-docs-to-diataxis-layout.cjs.
 * Pure string/path functions; no disk access.
 */

const path = require('path');

// Inline link, optional #anchor and optional "title": [t](path.md#a "T")
const INLINE_RE = /(\[[^\]]*\]\()([^)#\s<>]+)(#[^)]*)?(\s+(?:"[^"]*"|'[^']*'))?(\))/g;
// Reference definition: [label]: path.md "title" (footnotes [^n]: excluded)
const REFDEF_RE = /^(\s{0,3}\[(?!\^)[^\]]+\]:\s*)([^\s#<>]+)(.*)$/;
// HTML attributes: href="path.md#a" / src='img.png'
const HTML_RE = /(\b(?:href|src)\s*=\s*)(["'])([^"'#\s]+)(#[^"']*)?\2/gi;
const EXTERNAL_RE = /^([a-z][a-z0-9+.-]*:|\/)/i;
const FENCE_RE = /^\s*(`{3,}|~{3,})(.*)$/;

/** Old absolute path -> new absolute path (handles whole-directory moves). */
function mapPath(abs, moves) {
  for (const m of moves) {
    if (abs === m.src) return m.dst;
    if (m.isDir && abs.startsWith(m.src + path.sep)) return m.dst + abs.slice(m.src.length);
  }
  return abs;
}

/** Compute the new href for a relative target, or the original if unchanged. */
function rewriteHref(href, oldDir, newDir, moves) {
  if (!href || EXTERNAL_RE.test(href)) return href;
  const target = path.resolve(oldDir, href);
  const newTarget = mapPath(target, moves);
  if (newTarget === target && newDir === oldDir) return href;
  let rel = path.relative(newDir, newTarget).split(path.sep).join('/');
  if (href.startsWith('./') && !rel.startsWith('.')) rel = './' + rel;
  if (href.endsWith('/') && !rel.endsWith('/')) rel += '/';
  return rel;
}

/**
 * Track fenced code blocks by marker char + length (a ```` fence is not closed
 * by ```). Returns a stateful predicate: isCode(line) -> true for fence lines
 * and lines inside a fence.
 */
function createFenceTracker() {
  let open = null; // { ch, len }
  return line => {
    const m = FENCE_RE.exec(line);
    if (!open) {
      if (m) { open = { ch: m[1][0], len: m[1].length }; return true; }
      return false;
    }
    if (m && m[1][0] === open.ch && m[1].length >= open.len && m[2].trim() === '') open = null;
    return true;
  };
}

/** Rewrite relative markdown/HTML links (skips fenced code, external, absolute). */
function rewriteLinks(content, oldFile, newFile, moves) {
  let count = 0;
  const oldDir = path.dirname(oldFile);
  const newDir = path.dirname(newFile);
  const isCode = createFenceTracker();
  const fix = href => {
    const next = rewriteHref(href, oldDir, newDir, moves);
    if (next !== href) count++;
    return next;
  };
  const out = content.split('\n').map(line => {
    if (isCode(line)) return line;
    const ref = REFDEF_RE.exec(line);
    if (ref) return ref[1] + fix(ref[2]) + ref[3];
    return line
      .replace(INLINE_RE, (m, open, href, anchor = '', title = '', close) => open + fix(href) + anchor + title + close)
      .replace(HTML_RE, (m, attr, q, href, anchor = '') => attr + q + fix(href) + anchor + q);
  });
  return { content: out.join('\n'), count };
}

/** Rewrite plain-text full-path mentions (docs/<legacy> and ./docs/<legacy>). */
function rewritePlainPaths(content, moves, docsName) {
  let count = 0;
  for (const { from, to, isDir } of moves) {
    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Dir names may equal a sibling file stem (api/ vs api.md): don't match "docs/api" inside "docs/api.md".
    const end = isDir ? '(?![\\w-]|\\.\\w)' : '(?![\\w-])';
    const re = new RegExp(`(?<![\\w./-])(\\./)?${docsName}/${esc}${end}`, 'g');
    content = content.replace(re, (m, dot = '') => { count++; return `${dot}${docsName}/${to}`; });
  }
  return { content, count };
}

module.exports = { mapPath, rewriteHref, rewriteLinks, rewritePlainPaths, createFenceTracker };
