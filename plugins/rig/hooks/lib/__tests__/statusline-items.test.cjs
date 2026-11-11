'use strict';

/**
 * Statusline item toggles: the catalog, the visibility filter, and every item hidden through `.rig.json` in a real
 * statusline run (full mode), plus compact, minimal and the project-over-global merge.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ITEMS, ITEM_IDS, itemVisibility, applyItemVisibility } = require('../statusline-items.cjs');

const STATUSLINE = path.resolve(__dirname, '..', '..', '..', 'statusline.cjs');
const SESSION_ID = `items-test-${process.pid}`;

describe('statusline item catalog', () => {
  it('has unique ids, a known row, modes and a description for each item', () => {
    assert.strictEqual(new Set(ITEM_IDS).size, ITEM_IDS.length);
    for (const item of ITEMS) {
      assert.ok(['session', 'workspace', 'activity'].includes(item.row), item.id);
      assert.ok(item.modes.length > 0 && item.modes.every((m) => ['full', 'compact', 'minimal'].includes(m)), item.id);
      assert.ok(item.description.length > 10 && item.sample, item.id);
    }
  });
  it('matches the ids the config schema allows', () => {
    const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'schemas', 'rig-config.schema.json'), 'utf8'));
    assert.deepStrictEqual(schema.properties.statuslineItems.propertyNames.enum, ITEM_IDS);
  });
  it('itemVisibility: only an explicit false turns an item off; bad config means all on', () => {
    const on = itemVisibility({ cost: false, git: true, tools: 0 });
    assert.strictEqual(on('cost'), false);
    assert.strictEqual(on('git'), true);
    assert.strictEqual(on('tools'), true);
    assert.strictEqual(on('model'), true);
    for (const bad of [null, undefined, 'cost', ['cost']]) assert.strictEqual(itemVisibility(bad)('cost'), true);
  });
  it('applyItemVisibility blanks hidden data without touching the input', () => {
    const ctx = { agentName: 'a', costText: '$1', transcript: { tools: [1], agents: [2], todos: [3] } };
    const out = applyItemVisibility(ctx, itemVisibility({ agent: false, cost: false, agents: false }));
    assert.strictEqual(out.agentName, '');
    assert.strictEqual(out.costText, null);
    assert.deepStrictEqual(out.transcript, { tools: [1], agents: [], todos: [3] });
    assert.deepStrictEqual(ctx.transcript.agents, [2], 'input is not mutated');
    assert.deepStrictEqual([...out.hidden].sort(), ['agent', 'agents', 'cost']);
  });
});

describe('statusline run with items hidden', () => {
  let root, home, cwd, transcript;
  const sessionFile = path.join(os.tmpdir(), `rig-session-${SESSION_ID}.json`);

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-sl-items-'));
    home = path.join(root, 'home');
    cwd = path.join(root, 'proj');
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.mkdirSync(cwd);
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), '# p\n');
    const git = (...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
    git('init', '-q', '-b', 'feat-x');
    fs.writeFileSync(path.join(cwd, 'dirty.txt'), 'x');
    git('add', 'dirty.txt');
    fs.writeFileSync(sessionFile, JSON.stringify({ activePlan: 'plans/261111-1333-item-plan' }));
    transcript = path.join(root, 't.jsonl');
    const ts = new Date(Date.now() - 5000).toISOString();
    const use = (id, name, input) => JSON.stringify({ timestamp: ts, message: { content: [{ type: 'tool_use', id, name, input }] } });
    fs.writeFileSync(transcript, [
      use('g1', 'Grep', { pattern: 'needle' }),
      use('t1', 'Task', { subagent_type: 'researcher', description: 'Scouting the docs' }),
      use('w1', 'TodoWrite', { todos: [{ content: 'Write tests', activeForm: 'Writing the tests', status: 'in_progress' }, { content: 'Ship', status: 'pending' }] }),
    ].join('\n') + '\n');
  });
  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(sessionFile, { force: true });
  });

  const input = () => ({
    session_id: SESSION_ID, transcript_path: transcript,
    model: { display_name: 'Opus 5.5' }, agent: { name: 'rev' }, effort: { level: 'high' }, version: '2.1.330',
    output_style: { name: 'explanatory' }, vim: { mode: 'NORMAL' }, workspace: { current_dir: cwd },
    context_window: { context_window_size: 200000, used_percentage: 42, current_usage: { input_tokens: 84000 }, total_input_tokens: 120000, total_output_tokens: 18000 },
    cost: { total_cost_usd: 0.42, total_duration_ms: 1500000, total_api_duration_ms: 480000, total_lines_added: 120, total_lines_removed: 34 },
    rate_limits: { five_hour: { used_percentage: 38, resets_at: 9999999999 }, seven_day: { used_percentage: 61, resets_at: 9999999999 } },
  });
  function render(globalCfg, projectCfg) {
    fs.writeFileSync(path.join(home, '.claude', '.rig.json'), JSON.stringify(globalCfg));
    fs.rmSync(path.join(cwd, '.claude'), { recursive: true, force: true });
    if (projectCfg) {
      fs.mkdirSync(path.join(cwd, '.claude'));
      fs.writeFileSync(path.join(cwd, '.claude', '.rig.json'), JSON.stringify(projectCfg));
    }
    const res = spawnSync(process.execPath, [STATUSLINE], {
      cwd, input: JSON.stringify(input()), encoding: 'utf8',
      env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: '1', CLAUDE_BILLING_MODE: 'api', COLUMNS: '400' },
    });
    assert.strictEqual(res.status, 0, res.stderr);
    return res.stdout;
  }

  // What each item prints with the input above (NO_COLOR); hiding the item must remove exactly that text.
  const MARKERS = {
    model: '✦ Opus 5.5', agent: '@rev', effort: '▮▮▮▯▯ high', context: '42%', 'limit-5h': '5h ', 'limit-7d': '7d ',
    cost: '$0.420', duration: '◷', tokens: '◇', dir: '◆', git: '⎇ feat-x', 'git-state': 'feat-x +1', plan: '◎ item-plan',
    changes: '+120 -34', config: '≡', vim: '[NORMAL]', 'output-style': 'style:explanatory', version: 'v2.1.330',
    tools: 'Grep', agents: '⬡', todos: 'Writing the tests',
  };

  it('full mode shows every item by default', () => {
    const out = render({ statusline: 'full' });
    assert.deepStrictEqual(Object.keys(MARKERS).sort(), [...ITEM_IDS].sort(), 'one marker per item');
    for (const [id, marker] of Object.entries(MARKERS)) assert.ok(out.includes(marker), `${id}: "${marker}" missing in\n${out}`);
  });

  for (const id of Object.keys(MARKERS)) {
    it(`hides ${id}`, () => {
      const out = render({ statusline: 'full', statuslineItems: { [id]: false } });
      assert.ok(!out.includes(MARKERS[id]), `${id}: "${MARKERS[id]}" still shown in\n${out}`);
      for (const [other, marker] of Object.entries(MARKERS)) {
        // Hiding git also hides its state; the agents row repeats the subagent tool name only.
        if (other === id || (id === 'git' && other === 'git-state')) continue;
        assert.ok(out.includes(marker), `hiding ${id} also removed ${other} ("${marker}") from\n${out}`);
      }
    });
  }

  it('compact and minimal honor hidden items', () => {
    const compact = render({ statusline: 'compact', statuslineItems: { 'limit-5h': false, 'git-state': false } });
    assert.ok(!compact.includes('5h ') && !compact.includes('feat-x +1') && compact.includes('⎇ feat-x'), compact);
    const minimal = render({ statusline: 'minimal', statuslineItems: { dir: false, effort: false } });
    assert.ok(!minimal.includes('◆') && !minimal.includes('high') && minimal.includes('42% ctx'), minimal);
  });

  it('compact leaves out a line whose items are all hidden', () => {
    const out = render({ statusline: 'compact', statuslineItems: { dir: false, git: false } });
    assert.strictEqual(out.split('\n').filter(Boolean).length, 1, out);
  });

  it('the project file wins over the global file, both ways', () => {
    const out = render({ statusline: 'full', statuslineItems: { cost: false, version: true } }, { statuslineItems: { cost: true, version: false } });
    assert.ok(out.includes('$0.420') && !out.includes('v2.1.330'), out);
  });
});
