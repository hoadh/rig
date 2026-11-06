#!/usr/bin/env node
'use strict';

/**
 * ANSI Terminal Colors - Cross-platform color support for statusline
 * Supports NO_COLOR, FORCE_COLOR, COLORTERM auto-detection
 * @module colors
 */

// ANSI escape codes (8-color basic palette)
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';

// Detect color support at module load (cached)
// Claude Code statusline runs via pipe but output displays in TTY - default to true
const shouldUseColor = (() => {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  // Default true for statusline context (Claude Code handles TTY display)
  return true;
})();

// Mutable override (set by statusline.cjs from config)
// null = use env detection, true/false = explicit override
let _colorOverride = null;

/**
 * Set explicit color enable/disable override (from config)
 * Pass null to revert to env-var detection
 * @param {boolean} enabled
 */
function setColorEnabled(enabled) {
  _colorOverride = enabled;
}

/**
 * Determine if colors should be rendered, respecting env vars and config override
 * NO_COLOR env var always takes precedence over config override
 * @returns {boolean}
 */
function isColorEnabled() {
  // NO_COLOR env var is a hard override that always wins
  if (process.env.NO_COLOR) return false;
  if (_colorOverride !== null) return _colorOverride;
  return shouldUseColor;
}

// Detect 256-color support via COLORTERM
const has256Color = (() => {
  const ct = process.env.COLORTERM;
  return ct === 'truecolor' || ct === '24bit' || ct === '256color';
})();

/**
 * Wrap text with ANSI color code
 * @param {string} text - Text to colorize
 * @param {string} code - ANSI escape code
 * @returns {string} Colorized text or plain text if colors disabled
 */
function colorize(text, code) {
  if (!isColorEnabled()) return String(text);
  return `${code}${text}${RESET}`;
}

function green(text) { return colorize(text, GREEN); }
function yellow(text) { return colorize(text, YELLOW); }
function red(text) { return colorize(text, RED); }
function cyan(text) { return colorize(text, CYAN); }
function magenta(text) { return colorize(text, MAGENTA); }
function dim(text) { return colorize(text, DIM); }

/**
 * Get color code based on context percentage threshold
 * @param {number} percent - Context usage percentage (0-100)
 * @returns {string} ANSI color code
 */
function getContextColor(percent) {
  if (percent >= 85) return RED;
  if (percent >= 70) return YELLOW;
  return GREEN;
}

/**
 * Generate colored progress bar for context window
 * Uses ▰▱ characters (smooth horizontal rectangles) for consistent rendering
 * @param {number} percent - Usage percentage (0-100)
 * @param {number} width - Bar width in characters (default 12)
 * @returns {string} Unicode progress bar with threshold-based colors
 */
function coloredBar(percent, width = 12) {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;

  if (!isColorEnabled()) {
    return '▰'.repeat(filled) + '▱'.repeat(empty);
  }

  const color = getContextColor(percent);
  return `${color}${'▰'.repeat(filled)}${DIM}${'▱'.repeat(empty)}${RESET}`;
}

// ============================================================================
// 256-COLOR PALETTE (modern statusline theme)
// 256-color codes render in virtually every modern terminal, unlike truecolor
// which depends on COLORTERM being forwarded to the statusline process.
// ============================================================================

const PALETTE = {
  violet: 141,
  purple: 177,
  pink: 212,
  cyan: 81,
  teal: 79,
  blue: 75,
  green: 114,
  yellow: 221,
  orange: 215,
  red: 203,
  text: 252,
  muted: 245,
  faint: 239
};

// Severity gradient (green → red) used for usage bars, cell by cell
const HEAT_GRADIENT = [114, 150, 186, 221, 215, 209, 203];

/**
 * Color text with a 256-color foreground code
 * @param {string} text
 * @param {number} code - 0..255 palette index
 * @param {boolean} bold
 */
function fg(text, code, bold = false) {
  if (!isColorEnabled()) return String(text);
  return `\x1b[${bold ? '1;' : ''}38;5;${code}m${text}${RESET}`;
}

/** Pick gradient stop for a 0..1 position */
function gradientStop(stops, t) {
  const idx = Math.round(Math.max(0, Math.min(1, t)) * (stops.length - 1));
  return stops[idx];
}

/**
 * Pill badge: text on a 256-color background (e.g. the model name)
 * Plain " text " when colors are disabled
 */
function badge(text, bgCode, fgCode = 231) {
  if (!isColorEnabled()) return ` ${text} `;
  return `\x1b[1;48;5;${bgCode};38;5;${fgCode}m ${text} ${RESET}`;
}

/**
 * Severity color for a usage percentage (256-color variant of getContextColor)
 */
function heatColor(percent) {
  if (percent >= 85) return PALETTE.red;
  if (percent >= 70) return PALETTE.orange;
  if (percent >= 50) return PALETTE.yellow;
  return PALETTE.green;
}

/**
 * Sleek line bar where each filled cell is colored by its position on the
 * green → red heat gradient, so a nearly full bar visibly "heats up".
 * @param {number} percent - 0..100
 * @param {number} width - cells
 * @param {number|null} solid - optional single 256-color code instead of the heat gradient
 */
function gradientBar(percent, width = 10, solid = null) {
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  if (!isColorEnabled()) return '━'.repeat(filled) + '─'.repeat(empty);

  let bar = '';
  for (let i = 0; i < filled; i++) {
    const code = solid ?? gradientStop(HEAT_GRADIENT, width > 1 ? i / (width - 1) : 1);
    bar += `\x1b[38;5;${code}m━`;
  }
  bar += `\x1b[38;5;${PALETTE.faint}m${'─'.repeat(empty)}`;
  return bar + RESET;
}

module.exports = {
  RESET,
  PALETTE,
  fg,
  badge,
  gradientBar,
  heatColor,
  green,
  yellow,
  red,
  cyan,
  magenta,
  dim,
  getContextColor,
  coloredBar,
  shouldUseColor,
  has256Color,
  setColorEnabled,
  isColorEnabled
};
