/**
 * turn-edit-and-verify-scanner.cjs - reads the tail of a Claude Code transcript (JSONL) and reports
 * whether the CURRENT turn edited code and whether a passing check ran after the last edit.
 *
 * Shapes this relies on (captured from real transcripts, see the phase-01 notes):
 *   - one content block per entry; assistant `tool_use` blocks carry `id`, `name`, `input`
 *   - the matching result is a `user` entry whose content holds a `tool_result` with `tool_use_id`
 *     and `is_error` (a non-zero Bash exit is `is_error: true`, text `Exit code N ...`)
 *   - a genuine turn start is a `user` entry that is not a tool_result, not `isMeta`, not a compact
 *     summary and not an injected notice (task-notification, local-command output, interrupt marker,
 *     system reminder). Stop-hook feedback is NOT a user entry (attachment / system entries).
 *
 * Exports: scanTurn(transcriptPath, opts) -> result (see JSDoc), plus pure helpers for tests.
 */
const crypto = require('crypto');
const fs = require('fs');
const { detectVerifyCommand } = require('./verify-command-detector.cjs');

const TAIL_BYTES = 4 * 1024 * 1024;
const POLL_STEP_MS = 50;
const POLL_MAX_MS = 1000;
const WINDOW_KEY_PREFIX = 'w:';
const MESSAGE_PREFIX_CHARS = 200;
const MIN_CONCAT_MATCH_CHARS = 20; // shorter last entries ("Done.") are too ambiguous to match by inclusion

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const AGENT_TOOLS = new Set(['Agent', 'Task']);
const EDITING_AGENTS = new Set(['implementer', 'code-simplifier', 'debugger', 'ui-ux-designer']);
const DOC_EXT = /\.(md|mdx|markdown|txt|rst|adoc|png|jpe?g|gif|svg|webp|ico)$/i;
const PLANS_DIR = /(^|[\\/])plans[\\/]/;
// Text prefixes of user entries that are injected notices, never a human/loop prompt.
const NOT_A_PROMPT = /^\s*(<task-notification>|<local-command-(stdout|stderr|caveat)>|\[Request interrupted|<system-reminder>|Another Claude session sent|This session is being continued|Stop hook feedback)/;

/** Blocking sleep (the hook is synchronous and short-lived). */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Parses the last `maxBytes` of a JSONL file. A partial first line (window cut) and a partial last
 * line (writer mid-flush) are dropped.
 * @returns {{entries: object[], windowCut: boolean}}
 */
function readTailEntries(file, maxBytes = TAIL_BYTES) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    let read = 0;
    while (read < buf.length) {
      const n = fs.readSync(fd, buf, read, buf.length - read, start + read);
      if (n <= 0) break;
      read += n;
    }
    let lines = buf.subarray(0, read).toString('utf8').split('\n');
    if (start > 0) lines = lines.slice(1); // first line is cut mid-way
    const entries = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e && typeof e === 'object') entries.push(e);
      } catch {
        // truncated/garbled line: skip
      }
    }
    return { entries, windowCut: start > 0 };
  } finally {
    fs.closeSync(fd);
  }
}

function blocksOf(entry) {
  const c = entry && entry.message && entry.message.content;
  return Array.isArray(c) ? c.filter((b) => b && typeof b === 'object') : [];
}

/** Index and text of the last assistant entry that has a text block, or {idx: -1, text: ''}. */
function lastAssistantTextEntry(entries) {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].type !== 'assistant') continue;
    const text = blocksOf(entries[i]).filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
    if (text.trim()) return { idx: i, text };
  }
  return { idx: -1, text: '' };
}

/**
 * True when the transcript tail already holds our final message: it must be the LAST assistant text
 * entry AND sit after the last genuine turn start (an earlier turn's "Done." must not match).
 */
function transcriptHasMessage(entries, message) {
  const want = message.trim().slice(0, MESSAGE_PREFIX_CHARS);
  const { idx, text } = lastAssistantTextEntry(entries);
  const have = text.trim();
  if (!have) return false;
  for (let i = entries.length - 1; i > idx; i -= 1) {
    if (classifyUserEntry(entries[i]) === 'start') return false;
  }
  // equal prefix, or the message is the concatenation of several text entries ending in `have`
  const head = have.slice(0, MESSAGE_PREFIX_CHARS);
  return head === want || (head.length >= MIN_CONCAT_MATCH_CHARS && message.includes(head));
}

/**
 * Classifies a user entry: 'start' (genuine turn start), 'ambiguous' (unrecognised content), or 'other'.
 */
function classifyUserEntry(entry) {
  if (entry.type !== 'user' || entry.isMeta || entry.isCompactSummary) return 'other';
  const c = entry.message && entry.message.content;
  if (typeof c === 'string') return NOT_A_PROMPT.test(c) ? 'other' : 'start';
  if (!Array.isArray(c) || c.length === 0) return 'ambiguous';
  if (c.some((b) => b && b.type === 'tool_result')) return 'other';
  const texts = c.filter((b) => b && b.type === 'text' && typeof b.text === 'string');
  if (texts.length === 0) return 'ambiguous';
  return texts.every((b) => NOT_A_PROMPT.test(b.text)) ? 'other' : 'start';
}

function toolPath(input) {
  if (!input || typeof input !== 'object') return '';
  return String(input.file_path || input.notebook_path || input.path || '');
}

/** True when this tool_use changes code (docs-only paths and unknown paths aside). */
function isCodeEdit(block) {
  if (EDIT_TOOLS.has(block.name)) {
    const p = toolPath(block.input);
    return !(DOC_EXT.test(p) || PLANS_DIR.test(p));
  }
  if (AGENT_TOOLS.has(block.name)) {
    return EDITING_AGENTS.has(agentType(block));
  }
  return false;
}

function agentType(block) {
  const t = block.input && typeof block.input.subagent_type === 'string' ? block.input.subagent_type : '';
  return t.split(':').pop().trim();
}

/**
 * Walks one turn's entries: edits, verification commands, results.
 * @returns {{hasEdit: boolean, verified: boolean, failedCheck: string|null, maskedCheck: string|null}}
 */
function evaluateTurn(turnEntries, opts) {
  const uses = []; // {pos, id, name, block}
  const results = new Map(); // tool_use_id -> is_error
  turnEntries.forEach((entry, pos) => {
    for (const b of blocksOf(entry)) {
      if (entry.type === 'assistant' && b.type === 'tool_use') uses.push({ pos, id: b.id, name: b.name, block: b });
      if (entry.type === 'user' && b.type === 'tool_result') results.set(b.tool_use_id, b.is_error === true);
    }
  });

  let lastEdit = -1;
  uses.forEach((u, i) => {
    // an Edit that errored did not change anything; an Agent call has no usable result yet
    if (isCodeEdit(u.block) && !(EDIT_TOOLS.has(u.name) && results.get(u.id) === true)) lastEdit = i;
  });
  if (lastEdit < 0) return { hasEdit: false, verified: false, failedCheck: null, maskedCheck: null, patternTimeout: false };

  let verified = false;
  let failedCheck = null;
  let maskedCheck = null;
  let patternTimeout = false;
  for (let i = lastEdit + 1; i < uses.length; i += 1) {
    const u = uses[i];
    // A background run returns success at once, before any test has run: never evidence.
    if (u.block.input && u.block.input.run_in_background === true) continue;
    if (AGENT_TOOLS.has(u.name) && agentType(u.block) === 'tester') {
      // limitation: the tester's reported verdict is not parsed; a completed call counts
      if (results.get(u.id) !== true) verified = true;
      continue;
    }
    if (u.name !== 'Bash') continue;
    const command = u.block.input && u.block.input.command;
    const det = detectVerifyCommand(command, opts.detect);
    if (det.patternTimeout) patternTimeout = true;
    if (!det.isVerify || !results.has(u.id)) continue;
    if (det.masked) {
      maskedCheck = det.label; // exit status hidden by `;` `||` `|`: cannot count as a pass
      continue;
    }
    if (results.get(u.id) === true) {
      failedCheck = det.label;
      verified = false;
    } else {
      verified = true;
      failedCheck = null;
    }
  }
  return { hasEdit: true, verified, failedCheck: verified ? null : failedCheck, maskedCheck: verified || failedCheck ? null : maskedCheck, patternTimeout };
}

/** `w:<hash>` of the first entry in the window ('' for an empty window). */
function windowBoundaryKey(entries) {
  if (entries.length === 0) return '';
  const first = entries[0];
  const seed = String(first.uuid || first.timestamp || JSON.stringify(first).slice(0, 300));
  return `${WINDOW_KEY_PREFIX}${crypto.createHash('sha1').update(seed).digest('hex').slice(0, 12)}`;
}

/**
 * @param {string} transcriptPath
 * @param {{lastAssistantMessage?: string, tailBytes?: number, pollStepMs?: number, pollMaxMs?: number,
 *          detect?: {projectDir?: string, cwd?: string, extraPatterns?: RegExp[]}}} [opts]
 * @returns {{hasEdit: boolean, verified: boolean, failedCheck: string|null, maskedCheck: string|null, turnKey: string,
 *            lagged: boolean, windowExhausted: boolean, boundaryUnclear: boolean}}
 */
function scanTurn(transcriptPath, opts = {}) {
  const message = typeof opts.lastAssistantMessage === 'string' ? opts.lastAssistantMessage : '';
  const stepMs = opts.pollStepMs === undefined ? POLL_STEP_MS : opts.pollStepMs;
  const maxMs = opts.pollMaxMs === undefined ? POLL_MAX_MS : opts.pollMaxMs;
  const t0 = Date.now();

  // Transcript may lag the in-memory conversation at Stop: poll until our final text shows up.
  let read = readTailEntries(transcriptPath, opts.tailBytes);
  if (message.trim()) {
    while (!transcriptHasMessage(read.entries, message)) {
      if (Date.now() - t0 >= maxMs) {
        return { hasEdit: false, verified: false, failedCheck: null, maskedCheck: null, turnKey: '', lagged: true, windowExhausted: false, boundaryUnclear: false };
      }
      sleep(stepMs);
      read = readTailEntries(transcriptPath, opts.tailBytes);
    }
  }

  const { entries, windowCut } = read;
  let startIdx = -1;
  let boundaryUnclear = false;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const kind = classifyUserEntry(entries[i]);
    if (kind === 'start') {
      startIdx = i;
      break;
    }
    if (kind === 'ambiguous') boundaryUnclear = true;
  }
  // No start inside a cut window: evaluate what the window holds. A whole file without a start is just odd.
  const windowExhausted = startIdx < 0 && windowCut;
  const turnEntries = entries.slice(startIdx + 1);
  const start = startIdx >= 0 ? entries[startIdx] : null;
  // No turn start in the window: key on the window boundary (first entry) so it is not one constant.
  const turnKey = start ? String(start.uuid || start.timestamp || startIdx) : windowBoundaryKey(entries);
  const result = evaluateTurn(turnEntries, { detect: opts.detect || {} });
  return { ...result, turnKey, lagged: false, windowExhausted, boundaryUnclear };
}

module.exports = { scanTurn, readTailEntries, classifyUserEntry, evaluateTurn, transcriptHasMessage, TAIL_BYTES, WINDOW_KEY_PREFIX };
