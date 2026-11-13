/** Test helper: synthetic Antigravity transcript_full.jsonl steps (shape captured by the phase 01 probe). */
const user = (text, source = 'USER_EXPLICIT') => ({ type: 'USER_INPUT', source, status: 'DONE', content: `<USER_REQUEST>\n${text}\n</USER_REQUEST>` });
const planner = (content, tool_calls) => ({ type: 'PLANNER_RESPONSE', source: 'MODEL', status: 'DONE', ...(content ? { content } : {}), ...(tool_calls ? { tool_calls } : {}) });
const result = (content, status = 'DONE') => ({ type: 'GENERIC', source: 'MODEL', status, content });
const edit = (file) => ({ name: 'edit_file', args: { Path: file, Target: 'a', Replacement: 'b' } });
const run = (cmd) => ({ name: 'run_command', args: { CommandLine: cmd } });
const ok = (out = 'ok') => result(`Command exited with code 0.\n\nCommand output:\n${out}`);
const fail = () => result('Command exited with code 1.\n\nCommand output:\nFAIL');
const toJsonl = (steps) => steps.map((s, i) => JSON.stringify({ step_index: i, created_at: '2026-11-13T08:00:00Z', ...s })).join('\n') + '\n';

module.exports = { user, planner, result, edit, run, ok, fail, toJsonl };
