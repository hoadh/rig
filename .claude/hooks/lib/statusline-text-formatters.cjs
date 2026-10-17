#!/usr/bin/env node
'use strict';

/**
 * Statusline text formatters - width measurement, truncation, number/time formatting
 * Pure functions, no I/O. Shared by statusline renderers and layout.
 * @module statusline-text-formatters
 */

const os = require('os');
const path = require('path');

const GRAPHEME_SEGMENTER = (
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
)
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;

/**
 * Expand home directory to ~
 */
function expandHome(filePath) {
  const homeDir = os.homedir();
  // Require a separator boundary so /Users/alexander is not rewritten when home is /Users/alex
  if (filePath === homeDir) return '~';
  return filePath.startsWith(homeDir + path.sep) ? '~' + filePath.slice(homeDir.length) : filePath;
}

/**
 * Calculate terminal-visible string length.
 * Uses grapheme clusters and width heuristics for emoji/combining/CJK text.
 */
function visibleLength(str) {
  if (!str || typeof str !== 'string') return 0;
  const noAnsi = str.replace(/\x1b\[[0-9;]*m/g, '');
  const clusters = GRAPHEME_SEGMENTER
    ? Array.from(GRAPHEME_SEGMENTER.segment(noAnsi), s => s.segment)
    : Array.from(noAnsi);

  let len = 0;
  for (const cluster of clusters) {
    if (!cluster) continue;

    if (/^[\u0000-\u001f\u007f]+$/.test(cluster)) continue; // control chars
    if (/^\p{Mark}+$/u.test(cluster)) continue; // combining marks

    const first = cluster.codePointAt(0);
    if (first === 0x200d || first === 0xfe0e || first === 0xfe0f) continue;

    // Emoji grapheme clusters render as 2 columns in most terminals.
    if (/\p{Extended_Pictographic}/u.test(cluster)) {
      len += 2;
      continue;
    }

    // Full-width CJK ranges.
    if (first >= 0x1100 && (
      first <= 0x115f ||
      first === 0x2329 ||
      first === 0x232a ||
      (first >= 0x2e80 && first <= 0xa4cf && first !== 0x303f) ||
      (first >= 0xac00 && first <= 0xd7a3) ||
      (first >= 0xf900 && first <= 0xfaff) ||
      (first >= 0xfe10 && first <= 0xfe19) ||
      (first >= 0xfe30 && first <= 0xfe6f) ||
      (first >= 0xff00 && first <= 0xff60) ||
      (first >= 0xffe0 && first <= 0xffe6) ||
      (first >= 0x1f200 && first <= 0x1f251) ||
      (first >= 0x20000 && first <= 0x3fffd)
    )) {
      len += 2;
      continue;
    }

    len += 1;
  }
  return len;
}

/**
 * Truncate plain text to max characters with ellipsis
 */
function truncate(text, max) {
  const str = String(text ?? '');
  const chars = Array.from(str);
  if (chars.length <= max) return str;
  return max <= 1 ? '…' : chars.slice(0, max - 1).join('') + '…';
}

/**
 * Truncate in the middle, keeping the tail (useful for paths): "~/a/…/project/src"
 */
function truncateMiddle(text, max) {
  const chars = Array.from(String(text ?? ''));
  if (chars.length <= max) return chars.join('');
  const tail = Math.ceil((max - 1) * 0.6);
  return chars.slice(0, max - 1 - tail).join('') + '…' + chars.slice(-tail).join('');
}

/**
 * Compact token count: 950 → "950", 12345 → "12.3k", 1200000 → "1.2M"
 */
function formatTokens(n) {
  const num = Number(n) || 0;
  if (num >= 999500) return `${(num / 1e6).toFixed(num >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(num >= 1e5 ? 0 : 1).replace(/\.0$/, '')}k`;
  return String(Math.round(num));
}

/**
 * Human duration from milliseconds: "<1s", "42s", "12m 5s", "2h 15m", "3d 4h"
 */
function formatDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 1000) return '<1s';
  const totalSec = Math.floor(value / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Format elapsed time from start to end (or now)
 */
function formatElapsed(startTime, endTime) {
  if (!startTime) return '0s';
  const start = new Date(startTime).getTime();
  if (isNaN(start)) return '0s';
  const end = endTime ? new Date(endTime).getTime() : Date.now();
  if (isNaN(end)) return '0s';
  return formatDuration(end - start);
}

/**
 * Safe date parsing - returns epoch ms or 0 for invalid dates
 */
function safeGetTime(dateValue) {
  if (!dateValue) return 0;
  const time = new Date(dateValue).getTime();
  return isNaN(time) ? 0 : time;
}

module.exports = {
  expandHome,
  visibleLength,
  truncate,
  truncateMiddle,
  formatTokens,
  formatDuration,
  formatElapsed,
  safeGetTime
};
