// Run: node --test scripts/antigravity/hooks/__tests__/transcript.test.cjs
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { convertTranscript, toJsonl } = require('../antigravity-transcript-to-claude.cjs');
const { scanTurn } = require('../../../../plugins/rig/hooks/lib/turn-edit-and-verify-scanner.cjs');
const t = require('./transcript-builder.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-tr-'));
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
let n = 0;
const write = (steps) => { const f = path.join(dir, `t${n++}.jsonl`); fs.writeFileSync(f, t.toJsonl(steps)); return f; };
const scan = (steps, conv = 'c1') => {
  const c = convertTranscript(write(steps), conv);
  const out = path.join(dir, `claude${n++}.jsonl`);
  fs.writeFileSync(out, toJsonl(c.entries));
  return { c, scan: scanTurn(out, { lastAssistantMessage: c.lastAssistantMessage, detect: { projectDir: dir } }) };
};

test('main transcript: entries in Claude shape, tool names mapped', () => {
  const { c } = scan([t.user('fix it'), t.planner('', [t.edit('/w/a.js')]), t.result('edited'), t.planner('', [t.run('npm test')]), t.ok(), t.planner('All fixed.')]);
  assert.strictEqual(c.isSubagent, false);
  assert.strictEqual(c.lastAssistantMessage, 'All fixed.');
  const uses = c.entries.flatMap((e) => e.message.content).filter((b) => b.type === 'tool_use');
  assert.deepStrictEqual(uses.map((u) => u.name), ['Edit', 'Bash']);
  assert.deepStrictEqual([uses[0].input.file_path, uses[1].input.command], ['/w/a.js', 'npm test']);
});

test('subagent transcript (first step SYSTEM_MESSAGE) is flagged', () => {
  const c = convertTranscript(write([{ type: 'SYSTEM_MESSAGE', source: 'SYSTEM', content: 'x' }, t.planner('hi')]), 'c1');
  assert.strictEqual(c.isSubagent, true);
});

test('scanner on converted transcript: edit without verification is detected', () => {
  const { scan: s } = scan([t.user('fix it'), t.planner('', [t.edit('/w/a.js')]), t.result('edited'), t.planner('Done.')]);
  assert.deepStrictEqual([s.hasEdit, s.verified], [true, false]);
});

test('scanner: passing test after edit verifies; failing one is named', () => {
  const pass = scan([t.user('x'), t.planner('', [t.edit('/w/a.js')]), t.result('e'), t.planner('', [t.run('npm test')]), t.ok(), t.planner('Done.')]);
  assert.strictEqual(pass.scan.verified, true);
  const bad = scan([t.user('x'), t.planner('', [t.edit('/w/a.js')]), t.result('e'), t.planner('', [t.run('npm test')]), t.fail(), t.planner('Done.')]);
  assert.deepStrictEqual([bad.scan.verified, bad.scan.failedCheck], [false, 'npm test']);
});

test('scanner: only the last turn counts; docs-only edits are not code', () => {
  const two = scan([t.user('one'), t.planner('', [t.edit('/w/a.js')]), t.result('e'), t.planner('Done.'), t.user('two'), t.planner('Nothing to do.')]);
  assert.strictEqual(two.scan.hasEdit, false);
  const docs = scan([t.user('x'), t.planner('', [t.edit('/w/README.md')]), t.result('e'), t.planner('Done.')]);
  assert.strictEqual(docs.scan.hasEdit, false);
});

test('parallel tool calls pair results in order', () => {
  const { c } = scan([t.user('x'), t.planner('', [t.run('npm test'), t.run('npm run lint')]), t.ok(), t.fail(), t.planner('Done.')]);
  const results = c.entries.flatMap((e) => e.message.content).filter((b) => b.type === 'tool_result');
  assert.deepStrictEqual(results.map((r) => r.is_error), [false, true]);
});

test('invoke_subagent never counts as a tester run', () => {
  const sub = { name: 'invoke_subagent', args: { TypeName: 'tester', Role: 'r', Prompt: 'p' } };
  const { scan: s } = scan([t.user('x'), t.planner('', [t.edit('/w/a.js')]), t.result('e'), t.planner('', [sub]), t.result('Created the following subagent'), t.planner('Done.')]);
  assert.deepStrictEqual([s.hasEdit, s.verified], [true, false]);
});

test('turnId changes per explicit user input and per conversation, not per tool step', () => {
  const base = [t.user('same text'), t.planner('a')];
  const a = convertTranscript(write(base), 'c1').turnId;
  assert.strictEqual(convertTranscript(write([...base, t.planner('more')]), 'c1').turnId, a);
  assert.notStrictEqual(convertTranscript(write([...base, t.user('same text')]), 'c1').turnId, a);
  assert.notStrictEqual(convertTranscript(write(base), 'c2').turnId, a);
  const injected = convertTranscript(write([...base, t.user('nudge', 'SYSTEM')]), 'c1');
  assert.strictEqual(injected.turnId, a);
});

test('unusable input: missing, empty, garbage', () => {
  assert.strictEqual(convertTranscript(path.join(dir, 'nope.jsonl'), 'c'), null);
  const empty = path.join(dir, 'empty.jsonl'); fs.writeFileSync(empty, '');
  assert.strictEqual(convertTranscript(empty, 'c'), null);
  const junk = path.join(dir, 'junk.jsonl'); fs.writeFileSync(junk, 'not json\n{"a"\n');
  assert.strictEqual(convertTranscript(junk, 'c'), null);
});

// Live transcript (phase 05, scrubbed): SYSTEM_MESSAGE steps injected by our hooks sit between USER_INPUT and the
// model step; write_file{Append,Content,Path} is the edit tool.
const LIVE = path.join(__dirname, '..', '__fixtures__', 'live-write-file-transcript.jsonl');
const scanLive = (ext) => {
  const f = path.join(dir, `live${n++}.jsonl`);
  fs.writeFileSync(f, fs.readFileSync(LIVE, 'utf8').replace(/a\.txt/g, `a.${ext}`));
  const c = convertTranscript(f, 'live');
  const o = path.join(dir, `live-claude${n++}.jsonl`);
  fs.writeFileSync(o, toJsonl(c.entries));
  return { c, s: scanTurn(o, { lastAssistantMessage: c.lastAssistantMessage, detect: { projectDir: dir } }) };
};

test('live transcript: injected SYSTEM_MESSAGE steps do not start a turn; write_file maps to Write', () => {
  const { c, s } = scanLive('js');
  assert.strictEqual(c.isSubagent, false);
  assert.deepStrictEqual(c.entries.flatMap((e) => e.message.content).filter((b) => b.type === 'tool_use').map((b) => b.name), ['Write']);
  assert.deepStrictEqual([s.hasEdit, s.verified], [true, false]);
});

test('live transcript: the same edit on a .txt file is a docs edit, so no verification is due (scanner rule)', () => {
  assert.strictEqual(scanLive('txt').s.hasEdit, false);
});

// ---- L5: results pair only inside their batch, all or nothing ----
const toolResults = (c) => c.entries.flatMap((e) => e.message.content).filter((b) => b.type === 'tool_result');
const toolUses = (c) => c.entries.flatMap((e) => e.message.content).filter((b) => b.type === 'tool_use');

test('L5 live capture (agy 1.5.8): three parallel calls get their own results, in call order', () => {
  const c = convertTranscript(path.join(__dirname, '..', '__fixtures__', 'live-parallel-calls-transcript.jsonl'), 'c-live');
  const uses = toolUses(c);
  assert.deepStrictEqual(uses.map((u) => u.name), ['Write', 'Bash', 'Bash']);
  const byUse = new Map(toolResults(c).map((r) => [r.tool_use_id, r.content]));
  assert.match(byUse.get(uses[0].id), /Created file\./);
  assert.match(byUse.get(uses[1].id), /Command output:\nfirst/);
  assert.match(byUse.get(uses[2].id), /a\.js/);
});

test('L5 review ordering: a call without a GENERIC result leaves its whole batch unpaired (never shifted)', () => {
  // [run npm test, write a.js]: the test result is another step type, only the write has a GENERIC result
  const { c, scan: s } = scan([t.user('fix'), t.planner('', [t.run('npm test'), { name: 'write_file', args: { Path: '/w/a.js' } }]),
    { type: 'NOTIFICATION', source: 'SYSTEM', status: 'DONE', content: 'test output' }, t.result('Created file.'), t.planner('Done.')]);
  assert.deepStrictEqual(toolResults(c), [], 'nothing paired');
  assert.deepStrictEqual([s.hasEdit, s.verified], [true, false], 'the test never counts as verified');
});

test('L5: a result whose shape does not fit its call leaves the batch unpaired', () => {
  // the edit got the command-looking result and the test got the edit-looking one: swapped, so nothing pairs
  const { c, scan: s } = scan([t.user('fix'), t.planner('', [t.edit('/w/a.js'), t.run('npm test')]), t.ok('1 passing'), t.result('edited'), t.planner('Done.')]);
  assert.deepStrictEqual(toolResults(c), []);
  assert.strictEqual(s.verified, false);
});

test('L5: a short batch does not spill into the next one', () => {
  const { c, scan: s } = scan([t.user('fix'), t.planner('', [t.edit('/w/a.js'), t.run('npm test')]), t.result('edited'),
    t.planner('', [t.run('npm test')]), t.ok('1 passing'), t.planner('Done.')]);
  const uses = toolUses(c);
  assert.deepStrictEqual(toolResults(c).map((r) => r.tool_use_id), [uses[2].id], 'only the second batch pairs');
  assert.deepStrictEqual([s.hasEdit, s.verified], [true, true]);
});

test('L5 live capture with uneven durations (agy 1.5.8): results come in call order, not completion order', () => {
  // calls: `sleep 4; echo slow-first`, `echo fast-second`, `sleep 2; echo mid-third`
  const c = convertTranscript(path.join(__dirname, '..', '__fixtures__', 'live-uneven-durations-transcript.jsonl'), 'c-live2');
  const uses = toolUses(c);
  const byUse = new Map(toolResults(c).map((r) => [r.tool_use_id, r.content]));
  assert.deepStrictEqual(uses.map((u) => u.input.command), ['sleep 4; echo slow-first', 'echo fast-second', 'sleep 2; echo mid-third']);
  assert.deepStrictEqual(uses.map((u) => /Command output:\n(\S+)/.exec(byUse.get(u.id))[1]), ['slow-first', 'fast-second', 'mid-third']);
});
