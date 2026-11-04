#!/usr/bin/env node
/** Tests for the turn scanner: boundaries, pairing, lag poll, tail window. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const F = require('../../__tests__/verify-guard-transcript-fixture-builder.cjs');
const { scanTurn } = require('../turn-edit-and-verify-scanner.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-scan-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
let n = 0;
const FINAL = 'All done here.';
/** Scans a transcript made of `parts`; the final assistant text is FINAL. */
function scan(parts, opts = {}) {
  const file = F.writeTranscript(path.join(dir, `t${++n}.jsonl`), parts, F.text(FINAL));
  return scanTurn(file, { lastAssistantMessage: FINAL, pollMaxMs: 150, pollStepMs: 10, detect: { projectDir: dir, cwd: dir }, ...opts });
}
const P = () => F.prompt('fix the bug');

test('no edits / markdown-only / plans-only edits are clean', () => {
  assert.strictEqual(scan([P()]).hasEdit, false);
  assert.strictEqual(scan([P(), F.edit('/p/README.md'), F.edit('/p/plans/x/phase-01.md'), F.edit('/p/a.png')]).hasEdit, false);
});

test('code edit without check is unverified', () => {
  const r = scan([P(), F.edit('/p/a.cjs')]);
  assert.deepStrictEqual([r.hasEdit, r.verified, r.failedCheck], [true, false, null]);
});

test('edit then passing check is verified; failing check names the command', () => {
  assert.strictEqual(scan([P(), F.edit('/p/a.cjs'), F.bash('node --test a.test.cjs')]).verified, true);
  const r = scan([P(), F.edit('/p/a.cjs'), F.bash('node --test a.test.cjs', { error: true })]);
  assert.deepStrictEqual([r.verified, r.failedCheck], [false, 'node --test a.test.cjs']);
  const fixed = scan([P(), F.edit('/p/a.cjs'), F.bash('node --test a.test.cjs', { error: true }), F.bash('node --test a.test.cjs')]);
  assert.deepStrictEqual([fixed.verified, fixed.failedCheck], [true, null]);
});

test('masked, lookalike and out-of-order checks do not verify', () => {
  assert.strictEqual(scan([P(), F.edit('/p/a.cjs'), F.bash('node --test a.js || true')]).verified, false);
  assert.strictEqual(scan([P(), F.edit('/p/a.cjs'), F.bash('echo "node --test a.js"')]).verified, false);
  assert.strictEqual(scan([P(), F.bash('node --test a.js'), F.edit('/p/a.cjs')]).verified, false);
});

test('a check whose result is missing does not verify', () => {
  const id = 'toolu-orphan';
  assert.strictEqual(scan([P(), F.edit('/p/a.cjs'), F.toolUse('Bash', { command: 'node --test a.js' }, id)]).verified, false);
});

test('failed Edit calls are not edits', () => {
  assert.strictEqual(scan([P(), F.edit('/p/a.cjs', { error: true })]).hasEdit, false);
});

test('editing agents count as edits; tester agent verifies', () => {
  assert.strictEqual(scan([P(), F.agent('implementer')]).hasEdit, true);
  assert.strictEqual(scan([P(), F.agent('rig:code-simplifier')]).hasEdit, true);
  assert.strictEqual(scan([P(), F.agent('researcher')]).hasEdit, false);
  assert.strictEqual(scan([P(), F.agent('implementer'), F.agent('tester')]).verified, true);
  assert.strictEqual(scan([P(), F.agent('tester'), F.agent('implementer')]).verified, false);
});

test('injected entries between edit and stop do not start a new turn', () => {
  const noise = [F.compactSummary(), F.taskNotification(), F.localOutputUser(), F.localOutput(), F.interrupt(), F.metaUser('Another Claude session sent a message'), F.queuedAttachment(), ...F.stopFeedback()];
  for (const x of noise) {
    const r = scan([P(), F.edit('/p/a.cjs'), x]);
    assert.strictEqual(r.hasEdit, true, JSON.stringify(x).slice(0, 80));
    assert.strictEqual(r.boundaryUnclear, false);
  }
});

test('a new prompt (incl. slash command or /loop prompt) starts a new turn', () => {
  assert.strictEqual(scan([P(), F.edit('/p/a.cjs'), F.prompt('<command-message>loop</command-message>\n<command-name>/loop</command-name>')]).hasEdit, false);
  assert.strictEqual(scan([P(), F.edit('/p/a.cjs'), F.prompt('check the build')]).hasEdit, false);
});

test('turnKey is the start entry uuid and stable across continuation', () => {
  const start = P();
  const a = scan([start, F.edit('/p/a.cjs')]);
  const b = scan([start, F.edit('/p/a.cjs'), F.stopFeedback(), F.text('again')]);
  assert.strictEqual(a.turnKey, start.uuid);
  assert.strictEqual(b.turnKey, start.uuid);
});

test('ambiguous user entry is flagged boundary-unclear and not treated as a start', () => {
  const odd = { ...F.prompt('x'), message: { role: 'user', content: [] } };
  const r = scan([P(), F.edit('/p/a.cjs'), odd]);
  assert.strictEqual(r.hasEdit, true);
  assert.strictEqual(r.boundaryUnclear, true);
});

test('lag: final message never appears -> lagged; appears late -> evaluated', () => {
  const file = F.writeTranscript(path.join(dir, 'lag.jsonl'), P(), F.edit('/p/a.cjs'), F.text('older text'));
  const lagged = scanTurn(file, { lastAssistantMessage: 'brand new final message', pollMaxMs: 120, pollStepMs: 10 });
  assert.strictEqual(lagged.lagged, true);
  const file2 = path.join(dir, 'lag2.jsonl');
  F.writeTranscript(file2, P(), F.edit('/p/a.cjs'), F.text('older text'));
  // appended by a helper process while the scan polls
  const { spawn } = require('child_process');
  const appendEntry = JSON.stringify(F.text('late final message'));
  spawn(process.execPath, ['-e', `setTimeout(()=>require('fs').appendFileSync(${JSON.stringify(file2)}, ${JSON.stringify(appendEntry + '\n')}),150)`], { stdio: 'ignore' });
  const ok = scanTurn(file2, { lastAssistantMessage: 'late final message', pollMaxMs: 2000, pollStepMs: 20 });
  assert.strictEqual(ok.lagged, false);
  assert.strictEqual(ok.hasEdit, true);
});

test('empty last_assistant_message reads once, no polling', () => {
  const file = F.writeTranscript(path.join(dir, 'empty.jsonl'), P(), F.edit('/p/a.cjs'));
  const t0 = Date.now();
  const r = scanTurn(file, { lastAssistantMessage: '', detect: { projectDir: dir } });
  assert.strictEqual(r.hasEdit, true);
  assert.ok(Date.now() - t0 < 500);
});

test('turn start beyond the tail window: still evaluates the window, flags window-exhausted', () => {
  const filler = F.text('x'.repeat(2000));
  const parts = [P(), Array.from({ length: 80 }, () => filler), F.edit('/p/a.cjs')];
  const r = scan(parts, { tailBytes: 20000 });
  assert.strictEqual(r.windowExhausted, true);
  assert.strictEqual(r.hasEdit, true);
  assert.strictEqual(r.verified, false);
});

test('truncated last line (writer mid-flush) is skipped', () => {
  const file = F.writeTranscript(path.join(dir, 'trunc.jsonl'), P(), F.edit('/p/a.cjs'), F.text(FINAL));
  fs.appendFileSync(file, '{"type":"assistant","message":{"role":"assis');
  const r = scanTurn(file, { lastAssistantMessage: FINAL, pollMaxMs: 100, detect: { projectDir: dir } });
  assert.deepStrictEqual([r.lagged, r.hasEdit], [false, true]);
});

test('missing transcript throws (caller fails open)', () => {
  assert.throws(() => scanTurn(path.join(dir, 'nope.jsonl'), {}));
});

test('background Bash and background tester calls are not verification (M2)', () => {
  const bg = (cmd) => F.call('Bash', { command: cmd, run_in_background: true });
  assert.strictEqual(scan([P(), F.edit('/p/a.cjs'), bg('node --test a.test.cjs')]).verified, false);
  assert.strictEqual(scan([P(), F.edit('/p/a.cjs'), F.call('Agent', { subagent_type: 'tester', description: 'd', prompt: 'p', run_in_background: true })]).verified, false);
  // a foreground check after the background one still verifies
  assert.strictEqual(scan([P(), F.edit('/p/a.cjs'), bg('node --test a.test.cjs'), F.bash('node --test a.test.cjs')]).verified, true);
});

test('checks masked by ; || | do not verify and are reported as masked (M1)', () => {
  for (const c of ['node --test a.js; echo done', 'node --test a.js && echo ok || echo fail', 'node --test a.js | tail']) {
    const r = scan([P(), F.edit('/p/a.cjs'), F.bash(c)]);
    assert.strictEqual(r.verified, false, c);
    assert.strictEqual(r.maskedCheck, 'node --test a.js', c);
  }
  assert.strictEqual(scan([P(), F.edit('/p/a.cjs'), F.bash('node --test a.js && echo ok')]).verified, true);
});

test('a short earlier-turn last message ("Done.") is not a stale match for the new message (L3)', () => {
  const file = F.writeTranscript(path.join(dir, `stale${++n}.jsonl`), P(), F.text('Done.'), F.prompt('now fix the other thing'), F.edit('/p/a.cjs'));
  const r = scanTurn(file, { lastAssistantMessage: 'Fixed the other thing. Done.', pollMaxMs: 100, pollStepMs: 10, detect: { projectDir: dir, cwd: dir } });
  assert.strictEqual(r.lagged, true);
  // and the current message at the tail still matches normally
  const ok = F.writeTranscript(path.join(dir, `fresh${++n}.jsonl`), P(), F.text('Done.'), F.prompt('again'), F.edit('/p/a.cjs'), F.text('Fixed. Done.'));
  assert.strictEqual(scanTurn(ok, { lastAssistantMessage: 'Fixed. Done.', pollMaxMs: 100, pollStepMs: 10, detect: { projectDir: dir, cwd: dir } }).lagged, false);
});

test('window-exhausted turns get a boundary-derived key, not a constant (L5)', () => {
  const big = (tag) => [P(), ...Array.from({ length: 200 }, (_, i) => F.bash(`echo ${tag}-${i}`)), F.edit('/p/a.cjs')];
  const a = scan(big('a'), { tailBytes: 20000 });
  const b = scan(big('b'), { tailBytes: 20000 });
  assert.strictEqual(a.windowExhausted, true);
  assert.match(a.turnKey, /^w:[0-9a-f]{12}$/);
  assert.notStrictEqual(a.turnKey, b.turnKey);
});
