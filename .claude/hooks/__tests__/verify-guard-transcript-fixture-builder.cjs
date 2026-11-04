/**
 * Builds synthetic Claude Code transcript (JSONL) entries that mirror the shapes captured from real
 * sessions (one content block per entry, promptId on user entries, is_error on tool_result,
 * Stop-hook feedback as attachment/system entries). Test helper only.
 */
const fs = require('fs');

let seq = 0;
const nextId = (p) => `${p}-${String(++seq).padStart(4, '0')}`;
const base = (type) => ({ type, uuid: nextId('uuid'), timestamp: new Date(1762240000000 + seq * 1000).toISOString(), sessionId: 'sess-1', cwd: '/work/proj', entrypoint: 'cli', isSidechain: false });

const prompt = (text, extra = {}) => ({ ...base('user'), promptId: nextId('p'), message: { role: 'user', content: text }, ...extra });
const metaUser = (text) => ({ ...base('user'), isMeta: true, promptId: nextId('p'), message: { role: 'user', content: [{ type: 'text', text }] } });
const compactSummary = (text = 'This session is being continued from a previous conversation...') => ({ ...base('user'), isCompactSummary: true, message: { role: 'user', content: text } });
const interrupt = () => ({ ...base('user'), message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } });
const taskNotification = () => ({ ...base('user'), promptId: nextId('p'), message: { role: 'user', content: '<task-notification>\n<task-id>a1</task-id>\n</task-notification>' } });
const localOutput = () => ({ ...base('system'), subtype: 'local_command', content: '<local-command-stdout>ok</local-command-stdout>' });
const localOutputUser = () => ({ ...base('user'), message: { role: 'user', content: '<local-command-stdout>ok</local-command-stdout>' } });
const queuedAttachment = () => ({ ...base('attachment'), attachment: { type: 'queued_command', commandMode: 'task-notification', prompt: '<task-notification>x</task-notification>' } });
const text = (t) => ({ ...base('assistant'), message: { role: 'assistant', content: [{ type: 'text', text: t }], stop_reason: 'end_turn' } });
const thinking = () => ({ ...base('assistant'), message: { role: 'assistant', content: [{ type: 'thinking', thinking: '' }] } });
const toolUse = (name, input, id = nextId('toolu')) => ({ ...base('assistant'), message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' } });
const toolResult = (id, content = 'ok', isError = false) => ({ ...base('user'), message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content, is_error: isError }] } });
const stopFeedback = () => [
  { ...base('attachment'), attachment: { type: 'hook_additional_context', hookEvent: 'Stop', content: ['nudge'] } },
  { ...base('system'), subtype: 'stop_hook_summary' },
];

/** tool_use + result pair. */
function call(name, input, { error = false, out = 'ok' } = {}) {
  const id = nextId('toolu');
  return [toolUse(name, input, id), toolResult(id, error ? 'Exit code 1\nFAIL' : out, error)];
}
const bash = (command, opts) => call('Bash', { command }, opts);
const edit = (file_path, opts) => call('Edit', { file_path, old_string: 'a', new_string: 'b' }, opts);
const agent = (subagent_type) => call('Agent', { subagent_type, description: 'd', prompt: 'p' }, { out: 'launched' });

/** Writes entries (arrays are flattened) as JSONL; returns the path. */
function writeTranscript(file, ...parts) {
  const entries = parts.flat(Infinity);
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

module.exports = { prompt, metaUser, compactSummary, interrupt, taskNotification, localOutput, localOutputUser, queuedAttachment, text, thinking, toolUse, toolResult, stopFeedback, call, bash, edit, agent, writeTranscript };
