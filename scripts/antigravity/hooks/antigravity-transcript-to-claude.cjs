/**
 * antigravity-transcript-to-claude.cjs - converts an Antigravity transcript (transcript_full.jsonl) into the
 * Claude Code JSONL shape the unchanged turn-edit-and-verify-scanner reads.
 *
 * Antigravity steps: USER_INPUT (source USER_EXPLICIT for a real prompt), PLANNER_RESPONSE ({content, tool_calls[]}),
 * GENERIC (a tool result, `status` DONE|ERROR), SYSTEM_MESSAGE. Tool calls have no ids and results do not name their
 * call. A live capture (agy 1.5.8, three parallel calls: write_file, run_command x2) shows one GENERIC step per call,
 * in call order, right after the PLANNER_RESPONSE. So results are paired only inside their batch (the GENERIC steps
 * after one PLANNER_RESPONSE), and only when the batch adds up: as many results as calls, and each result has the
 * shape of its call (a run_command result reads "Command exited with code" or a background note; a write/edit result
 * does not). Otherwise the whole batch stays unpaired: its calls count as unverified (fail closed, L5), and no result
 * ever moves onto another call.
 *
 * Mapping: run_command -> Bash{command}; write_file / write_to_file -> Write{file_path}; edit_file /
 * replace_file_content / multi_replace_file_content -> Edit{file_path}. invoke_subagent is kept under its own name
 * on purpose: its result only says the subagent started, so it must not count as a finished tester or implementer.
 */
const crypto = require('crypto');
const fs = require('fs');

const MAX_BYTES = 16 * 1024 * 1024;
const WRITE_TOOLS = new Set(['write_file', 'write_to_file']);
const EDIT_TOOLS = new Set(['edit_file', 'replace_file_content', 'multi_replace_file_content']);
// Assumption (verify in phase 05): a run_command result that says it went to the background is not evidence.
const BACKGROUND_RESULT = /\b(running in (the )?background|background command)\b/i;
const EXIT_CODE = /Command exited with code (-?\d+)/;

const textOf = (v) => (typeof v === 'string' ? v : '');
const pathArg = (a) => textOf(a.Path || a.TargetFile || a.AbsolutePath || a.file_path);

function mapToolUse(name, args) {
  const a = args && typeof args === 'object' ? args : {};
  if (name === 'run_command') return { name: 'Bash', input: { command: textOf(a.CommandLine) } };
  if (WRITE_TOOLS.has(name)) return { name: 'Write', input: { file_path: pathArg(a) } };
  if (EDIT_TOOLS.has(name)) return { name: 'Edit', input: { file_path: pathArg(a) } };
  return { name, input: a };
}

function isErrorResult(step) {
  if (step.status === 'ERROR') return true;
  const m = EXIT_CODE.exec(textOf(step.content));
  return m !== null && Number(m[1]) !== 0;
}

const COMMAND_RESULT = /Command exited with code -?\d+|Command output:/;

/** Does `step` look like the result of `use` (a mapped tool_use entry)? An ERROR step fits any call. */
function resultFits(use, step) {
  if (step.status === 'ERROR') return true;
  const name = use.message.content[0].name;
  const text = textOf(step.content);
  if (name === 'Bash') return COMMAND_RESULT.test(text) || BACKGROUND_RESULT.test(text);
  if (name === 'Write' || name === 'Edit') return !EXIT_CODE.test(text);
  return true;
}

function readSteps(file) {
  if (fs.statSync(file).size > MAX_BYTES) return null;
  const steps = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const s = JSON.parse(line);
      if (s && typeof s === 'object') steps.push(s);
    } catch {
      // partial last line while the writer flushes: skip
    }
  }
  return steps;
}

/**
 * @returns {null | {isSubagent: boolean, entries: object[], lastAssistantMessage: string, turnId: string}}
 * null: unreadable, empty or oversized transcript (the caller does nothing).
 */
function convertTranscript(file, conversationId) {
  let steps;
  try {
    steps = readSteps(file);
  } catch {
    return null;
  }
  if (!steps || steps.length === 0) return null;

  const entries = [];
  let batch = null; // { calls: tool_use entries of one PLANNER_RESPONSE, results: GENERIC steps after it }
  let explicitCount = 0;
  let lastPrompt = '';
  let lastAssistantMessage = '';
  const uuid = (i, j = 0) => `agy-${i}-${j}`;

  /** Pair a finished batch, all or nothing (see the header). */
  const flush = () => {
    if (!batch) return;
    const { calls, results } = batch;
    batch = null;
    if (calls.length === 0 || results.length !== calls.length || !calls.every((use, k) => resultFits(use, results[k].step))) return;
    calls.forEach((use, k) => {
      const { step, i } = results[k];
      const block = use.message.content[0];
      if (block.name === 'Bash' && BACKGROUND_RESULT.test(textOf(step.content))) block.input.run_in_background = true;
      entries.push({ type: 'user', uuid: uuid(i), timestamp: step.created_at, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: block.id, is_error: isErrorResult(step), content: textOf(step.content).slice(0, 2000) }] } });
    });
  };

  steps.forEach((step, i) => {
    const ts = step.created_at;
    if (step.type === 'USER_INPUT') {
      flush();
      const explicit = step.source === 'USER_EXPLICIT';
      if (explicit) { explicitCount += 1; lastPrompt = textOf(step.content); lastAssistantMessage = ''; }
      entries.push({ type: 'user', uuid: uuid(i), timestamp: ts, isMeta: !explicit, message: { role: 'user', content: [{ type: 'text', text: textOf(step.content) }] } });
    } else if (step.type === 'PLANNER_RESPONSE') {
      flush();
      const text = textOf(step.content);
      if (text.trim()) {
        lastAssistantMessage = text;
        entries.push({ type: 'assistant', uuid: uuid(i), timestamp: ts, message: { role: 'assistant', content: [{ type: 'text', text }] } });
      }
      const calls = [];
      (Array.isArray(step.tool_calls) ? step.tool_calls : []).forEach((call, j) => {
        const { name, input } = mapToolUse(call && call.name, call && call.args);
        const entry = { type: 'assistant', uuid: uuid(i, j + 1), timestamp: ts, message: { role: 'assistant', content: [{ type: 'tool_use', id: `agy-call-${i}-${j}`, name, input }] } };
        entries.push(entry);
        calls.push(entry);
      });
      batch = { calls, results: [] };
    } else if (step.type === 'GENERIC' && batch) {
      batch.results.push({ step, i });
    }
  });
  flush();

  const turnId = crypto.createHash('sha256').update(`${conversationId}:${explicitCount}:${lastPrompt}`).digest('hex').slice(0, 16);
  return { isSubagent: steps[0].type === 'SYSTEM_MESSAGE', entries, lastAssistantMessage, turnId };
}

const toJsonl = (entries) => `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`;

module.exports = { convertTranscript, toJsonl };
