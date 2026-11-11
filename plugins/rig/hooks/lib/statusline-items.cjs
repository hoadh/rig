'use strict';

/**
 * Statusline item catalog and visibility.
 *
 * One entry per item a user can turn on or off (`statuslineItems` in `.rig.json`, `rig-statusline`). Hiding an item
 * blanks its data in the render context, so every mode (full, compact, minimal) honors it without per-mode code.
 * `model`, `dir` and `git-state` have no "empty" value; their segments check `ctx.hidden`.
 * @module statusline-items
 */

const ALL = ['full', 'compact', 'minimal'];

/** @type {{id: string, row: string, modes: string[], sample: string, description: string}[]} */
const ITEMS = [
  { id: 'model', row: 'session', modes: ALL, sample: '✦ Opus 5.5', description: 'Model name of the session.' },
  { id: 'agent', row: 'session', modes: ALL, sample: '@reviewer', description: 'Agent name next to the model, when the session runs as an agent (`claude --agent`).' },
  { id: 'effort', row: 'session', modes: ALL, sample: '▮▮▮▯▯ high', description: 'Reasoning effort level (changes with /effort); the meter shows in full mode only.' },
  { id: 'context', row: 'session', modes: ALL, sample: '━━━━────── 42% 84k/200k', description: 'Context window used: bar, percent and tokens (minimal: percent only).' },
  { id: 'limit-5h', row: 'session', modes: ALL, sample: '5h ━━──── 38% ↻ 2h 15m', description: '5-hour plan usage and time to reset (subscription plans only).' },
  { id: 'limit-7d', row: 'session', modes: ['full'], sample: '7d 61% ↻ 3d 4h', description: '7-day plan usage and time to reset (subscription plans only).' },
  { id: 'cost', row: 'session', modes: ['full'], sample: '$0.42', description: 'Session cost in USD (API billing only; hidden on subscription plans).' },
  { id: 'duration', row: 'session', modes: ['full'], sample: '◷ 25m api 8m', description: 'Session wall time and time spent waiting on the API.' },
  { id: 'tokens', row: 'session', modes: ['full'], sample: '◇ 120k in 18k out', description: 'Total input and output tokens of the session.' },
  { id: 'dir', row: 'workspace', modes: ALL, sample: '◆ ~/Work/app', description: 'Current working directory.' },
  { id: 'git', row: 'workspace', modes: ALL, sample: '⎇ main', description: 'Git branch. Turning it off also turns off the git state and skips all git calls.' },
  { id: 'git-state', row: 'workspace', modes: ['full', 'compact'], sample: '+2 ~3 ⇡1 ⇣0 / ✓', description: 'Staged (+), unstaged (~), ahead (⇡) and behind (⇣) counts after the branch; ✓ when clean.' },
  { id: 'plan', row: 'workspace', modes: ['full'], sample: '◎ statusline-item-toggles', description: 'Active Rig plan of the session.' },
  { id: 'changes', row: 'workspace', modes: ['full'], sample: '+120 -34', description: 'Lines added and removed in this session.' },
  { id: 'config', row: 'workspace', modes: ['full'], sample: '≡ 2 md · 3 rules · 1 mcp · 5 hooks', description: 'Counts of CLAUDE.md files, rules, MCP servers and hooks in effect.' },
  { id: 'vim', row: 'workspace', modes: ['full'], sample: '[NORMAL]', description: 'Vim mode, when vim keybindings are on.' },
  { id: 'output-style', row: 'workspace', modes: ['full'], sample: 'style:explanatory', description: 'Output style, when not the default.' },
  { id: 'version', row: 'workspace', modes: ['full'], sample: 'v2.1.330', description: 'Claude Code version.' },
  { id: 'tools', row: 'activity', modes: ['full'], sample: '◐ Bash npm test 12s / tools Read×8 Bash×5', description: 'Running tool with elapsed time, else the most used tools and error count.' },
  { id: 'agents', row: 'activity', modes: ['full'], sample: '⬡ ○ tester → ● code-reviewer 1 running', description: 'Subagent flow, running and done counts, and the current subagent task.' },
  { id: 'todos', row: 'activity', modes: ['full'], sample: '▸ Writing tests ━━━━──── 2/4', description: 'Current todo and todo progress.' },
];

const ITEM_IDS = ITEMS.map((i) => i.id);

/** `id -> boolean` from the `statuslineItems` config; missing or non-boolean values mean on, unknown ids are ignored. */
function itemVisibility(statuslineItems) {
  const cfg = statuslineItems && typeof statuslineItems === 'object' && !Array.isArray(statuslineItems) ? statuslineItems : {};
  return (id) => cfg[id] !== false;
}

/** Fields each item owns in the render context, and their "nothing to show" value. */
const BLANKS = {
  agent: { agentName: '' },
  effort: { effortLevel: '' },
  context: { contextSize: 0 },
  'limit-5h': { fiveHour: null },
  'limit-7d': { sevenDay: null },
  cost: { costText: null },
  duration: { durationMs: 0, apiDurationMs: 0 },
  tokens: { inputTokens: 0, outputTokens: 0 },
  git: { git: null },
  plan: { activePlan: '' },
  changes: { linesAdded: 0, linesRemoved: 0 },
  config: { configs: null },
  vim: { vimMode: '' },
  'output-style': { outputStyle: '' },
  version: { version: '' },
};
const TRANSCRIPT_ITEMS = { tools: 'tools', agents: 'agents', todos: 'todos' };

/**
 * A copy of the render context with every hidden item blanked; `hidden` holds the hidden ids.
 * @param {object} ctx render context built by statusline.cjs
 * @param {(id: string) => boolean} isOn from itemVisibility
 */
function applyItemVisibility(ctx, isOn) {
  const out = { ...ctx, hidden: new Set(ITEM_IDS.filter((id) => !isOn(id))) };
  for (const id of out.hidden) {
    if (BLANKS[id]) Object.assign(out, BLANKS[id]);
  }
  const hiddenLists = Object.keys(TRANSCRIPT_ITEMS).filter((id) => out.hidden.has(id));
  if (hiddenLists.length && out.transcript) {
    out.transcript = { ...out.transcript };
    for (const id of hiddenLists) out.transcript[TRANSCRIPT_ITEMS[id]] = [];
  }
  return out;
}

module.exports = { ITEMS, ITEM_IDS, itemVisibility, applyItemVisibility };
