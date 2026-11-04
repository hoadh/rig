#!/usr/bin/env node
/**
 * Integration tests for the verify-completion-guard Stop hook: spawns a COPY of the hook installed
 * in a temp HOME (isolated hook log + global ~/.claude/.rig.json) with Stop JSON on stdin.
 * HOME and USERPROFILE are both set (Windows uses the latter); RIG_SESSION_ID is cleared.
 * Run: node --test .claude/hooks/__tests__/verify-completion-guard.test.cjs
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const F = require('./verify-guard-transcript-fixture-builder.cjs');
const { stateFile } = require('../lib/verify-guard-turn-counter.cjs');

const HOOKS_SRC = path.resolve(__dirname, '..');
const roots = [];
let counter = 0;
// Counter state lives in os.tmpdir(); fixture uuids are deterministic, so session ids must be unique per run.
const NONCE = `${process.pid}-${Date.now()}`;
const sessions = new Set();
test.after(() => {
  roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true }));
  sessions.forEach((id) => fs.rmSync(stateFile(id), { force: true }));
});

/** Temp world: HOME with hook copy + optional global config; project dir with optional config/lockfile. */
function setup({ globalCfg, projectCfg, files } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rig-vcg-')));
  roots.push(root);
  const home = path.join(root, 'home');
  const proj = path.join(root, 'proj');
  const dest = path.join(home, '.claude', 'hooks');
  fs.mkdirSync(path.join(dest, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
  fs.copyFileSync(path.join(HOOKS_SRC, 'verify-completion-guard.cjs'), path.join(dest, 'verify-completion-guard.cjs'));
  for (const f of fs.readdirSync(path.join(HOOKS_SRC, 'lib'))) {
    if (f.endsWith('.cjs')) fs.copyFileSync(path.join(HOOKS_SRC, 'lib', f), path.join(dest, 'lib', f));
  }
  if (globalCfg) fs.writeFileSync(path.join(home, '.claude', '.rig.json'), JSON.stringify(globalCfg));
  if (projectCfg) fs.writeFileSync(path.join(proj, '.claude', '.rig.json'), JSON.stringify(projectCfg));
  for (const [name, body] of Object.entries(files || {})) fs.writeFileSync(path.join(proj, name), body);
  return { root, home, proj, hook: path.join(dest, 'verify-completion-guard.cjs'), logFile: path.join(dest, '.logs', 'hook-log.jsonl') };
}

const FINAL = 'Fixed it.';
/** Runs the hook against a transcript made of `parts`; returns {out, logs, status}. */
function run(w, parts, { payload = {}, env = {}, final = FINAL, session = `s-${++counter}` } = {}) {
  session = `${session}-${NONCE}`;
  sessions.add(session);
  const transcript = F.writeTranscript(path.join(w.root, `t${counter}.jsonl`), parts, F.text(final));
  const input = { session_id: session, transcript_path: transcript, cwd: w.proj, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: final, ...payload };
  const childEnv = { ...process.env, HOME: w.home, USERPROFILE: w.home, RIG_SESSION_ID: '', CLAUDE_PROJECT_DIR: w.proj, ...env };
  for (const k of ['CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ATTENDED', 'RIG_VERIFY_GUARD_MODE']) if (!(k in env)) delete childEnv[k];
  const r = spawnSync(process.execPath, [w.hook], { input: typeof payload === 'string' ? payload : JSON.stringify(input), env: childEnv, encoding: 'utf8' });
  const logs = fs.existsSync(w.logFile) ? fs.readFileSync(w.logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { status: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout) : null, logs, stderr: r.stderr };
}
const P = () => F.prompt('fix the bug');
const nudge = (r) => r.out && r.out.hookSpecificOutput && r.out.hookSpecificOutput.additionalContext;
const notes = (r) => r.logs.map((l) => l.note).join('\n');

test('no edits and markdown-only edits: silent', () => {
  const w = setup();
  assert.strictEqual(run(w, [P()]).out, null);
  assert.strictEqual(run(w, [P(), F.edit('/p/README.md')]).out, null);
});

test('unverified edit: one additionalContext nudge, logged as unverified', () => {
  const w = setup();
  const r = run(w, [P(), F.edit('/p/a.cjs')]);
  assert.strictEqual(r.status, 0);
  assert.match(nudge(r), /no passing test\/build\/typecheck\/lint/);
  assert.ok(nudge(r).length <= 600);
  assert.match(notes(r), /unverified mode=remind src=default/);
});

test('edit + passing test: silent; failing test: nudge names the failed command', () => {
  const w = setup();
  assert.strictEqual(run(w, [P(), F.edit('/p/a.cjs'), F.bash('node --test x.test.cjs')]).out, null);
  const r = run(w, [P(), F.edit('/p/a.cjs'), F.bash('node --test x.test.cjs', { error: true })]);
  assert.match(nudge(r), /last check `node --test x\.test\.cjs` failed/);
});

test('masked / lookalike / check-before-edit all nudge', () => {
  const w = setup();
  for (const parts of [
    [P(), F.edit('/p/a.cjs'), F.bash('node --test a.js || true')],
    [P(), F.edit('/p/a.cjs'), F.bash('echo "node --test a.js"')],
    [P(), F.edit('/p/a.cjs'), F.bash('git commit -m "node --test a.js"')],
    [P(), F.edit('/p/a.cjs'), F.bash('make clean')],
    [P(), F.bash('node --test a.js'), F.edit('/p/a.cjs')],
  ]) assert.ok(nudge(run(w, parts)), JSON.stringify(parts.flat()[2].message.content[0].input || ''));
  assert.strictEqual(run(w, [P(), F.edit('/p/a.cjs'), F.bash('node .claude/hooks/__tests__/x.test.cjs')]).out, null);
});

test('implementer agent: nudge unless a tester agent follows', () => {
  const w = setup();
  assert.ok(nudge(run(w, [P(), F.agent('implementer')])));
  assert.strictEqual(run(w, [P(), F.agent('implementer'), F.agent('tester')]).out, null);
});

test('injected entries and new prompts follow turn rules', () => {
  const w = setup();
  assert.ok(nudge(run(w, [P(), F.edit('/p/a.cjs'), F.compactSummary(), F.taskNotification(), F.interrupt(), F.localOutputUser()])));
  assert.strictEqual(run(w, [P(), F.edit('/p/a.cjs'), F.prompt('/loop check')]).out, null);
});

test('stop_hook_active=true allows (remind mode)', () => {
  const w = setup();
  const r = run(w, [P(), F.edit('/p/a.cjs')], { payload: { stop_hook_active: true } });
  assert.strictEqual(r.out, null);
  assert.match(notes(r), /skip stop-hook-active/);
});

test('remind nudges once per turn; a new turn nudges again', () => {
  const w = setup();
  const start = P();
  const t = [start, F.edit('/p/a.cjs')];
  assert.ok(nudge(run(w, t, { session: 'once' })));
  const second = run(w, [...t, F.stopFeedback(), F.text('still done')], { session: 'once', final: FINAL });
  assert.strictEqual(second.out, null);
  assert.match(notes(second), /remind-cap/);
  assert.ok(nudge(run(w, [P(), F.edit('/p/b.cjs')], { session: 'once' })));
});

test('block mode: blocks twice, third allowed with block-cap; escape phrase allows', () => {
  const w = setup({ globalCfg: { verifyGuard: { mode: 'block' } } });
  const t = [P(), F.edit('/p/a.cjs')];
  const opts = { session: 'blk', payload: { stop_hook_active: true } };
  const first = run(w, t, opts);
  assert.strictEqual(first.out.decision, 'block');
  assert.match(first.out.reason, /Verification skipped:/);
  assert.strictEqual(run(w, t, opts).out.decision, 'block');
  const third = run(w, t, opts);
  assert.strictEqual(third.out, null);
  assert.match(notes(third), /block-cap/);

  const ok = run(w, t, { final: 'Not run.\nVerification skipped: no suite exists' });
  assert.strictEqual(ok.out, null);
  const mid = run(w, t, { final: 'Note that Verification skipped: is not a line start' });
  assert.strictEqual(mid.out.decision, 'block');
});

test('off switches: env, headless entrypoint, unattended session, global mode off, global toggle', () => {
  const t = [P(), F.edit('/p/a.cjs')];
  const w = setup();
  assert.strictEqual(run(w, t, { env: { RIG_VERIFY_GUARD_MODE: 'off' } }).out, null);
  assert.strictEqual(run(w, t, { env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' } }).out, null);
  assert.strictEqual(run(w, t, { env: { CLAUDE_CODE_SESSION_ATTENDED: '0' } }).out, null);
  assert.ok(nudge(run(w, t, { env: { CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CODE_SESSION_ATTENDED: '1' } })));
  assert.strictEqual(run(setup({ globalCfg: { verifyGuard: { mode: 'off' } } }), t).out, null);
  assert.strictEqual(run(setup({ globalCfg: { hooks: { 'verify-completion-guard': false } } }), t).out, null);
});

test('config ladder: project raises, cannot lower; project toggle ignored from a subdir cwd', () => {
  const t = [P(), F.edit('/p/a.cjs')];
  assert.strictEqual(run(setup({ globalCfg: { verifyGuard: { mode: 'block' } }, projectCfg: { verifyGuard: { mode: 'off' } } }), t).out.decision, 'block');
  const raised = run(setup({ globalCfg: { verifyGuard: { mode: 'off' } }, projectCfg: { verifyGuard: { mode: 'block' } } }), t);
  assert.strictEqual(raised.out.decision, 'block');
  assert.match(notes(raised), /src=project/);
  const w = setup({ projectCfg: { hooks: { 'verify-completion-guard': false } } });
  fs.mkdirSync(path.join(w.proj, 'sub'));
  assert.ok(nudge(run(w, t, { payload: { cwd: path.join(w.proj, 'sub') } })));
});

test('project extraCommandPatterns ignored; global ones apply; unsafe ones rejected and logged', () => {
  const t = [P(), F.edit('/p/a.cjs'), F.bash('./ci/e2e.sh')];
  assert.ok(nudge(run(setup({ projectCfg: { verifyGuard: { extraCommandPatterns: ['^\\./ci/e2e\\.sh'] } } }), t)));
  assert.strictEqual(run(setup({ globalCfg: { verifyGuard: { extraCommandPatterns: ['^\\./ci/e2e\\.sh'] } } }), t).out, null);
  const bad = run(setup({ globalCfg: { verifyGuard: { extraCommandPatterns: ['(a+)+'] } } }), t);
  assert.match(notes(bad), /extraCommandPatterns rejected/);
});

test('nudge names the project package manager from lockfiles', () => {
  const w = setup({ files: { 'bun.lock': '', 'package.json': JSON.stringify({ scripts: { test: 'x' } }) } });
  assert.match(nudge(run(w, [P(), F.edit('/p/a.cjs')])), /`bun test`/);
});

test('transcript lag allows and logs transcript-lag', () => {
  const w = setup();
  const r = run(w, [P(), F.edit('/p/a.cjs')], { payload: { last_assistant_message: 'a message that never reaches the transcript' } });
  assert.strictEqual(r.out, null);
  assert.match(notes(r), /transcript-lag/);
});

test('garbage stdin, missing transcript, empty stdin: exit 0, silent', () => {
  const w = setup();
  for (const input of ['', 'not json', '[]', JSON.stringify({ hook_event_name: 'Stop', transcript_path: '/nope.jsonl' })]) {
    const r = spawnSync(process.execPath, [w.hook], { input, env: { ...process.env, HOME: w.home, USERPROFILE: w.home, CLAUDE_PROJECT_DIR: w.proj }, encoding: 'utf8' });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout.trim(), '');
  }
  const garbage = path.join(w.root, 'garbage.jsonl');
  fs.writeFileSync(garbage, '\u0000\u0001{{{\n[[\n');
  const r = spawnSync(process.execPath, [w.hook], { input: JSON.stringify({ hook_event_name: 'Stop', transcript_path: garbage, session_id: 'g' }), env: { ...process.env, HOME: w.home, USERPROFILE: w.home, CLAUDE_PROJECT_DIR: w.proj }, encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout.trim(), '');
});

test('static real-shape fixtures (incl. truncated tail) behave as documented', () => {
  const dir = path.join(__dirname, 'fixtures', 'verify-guard');
  const w = setup();
  const fromFixture = (name) => {
    const sid = `fx-${name}-${NONCE}`;
    sessions.add(sid);
    const input = { session_id: sid, transcript_path: path.join(dir, name), cwd: w.proj, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'Fixed it.' };
    const env = { ...process.env, HOME: w.home, USERPROFILE: w.home, RIG_SESSION_ID: '', CLAUDE_PROJECT_DIR: w.proj };
    for (const k of ['CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ATTENDED', 'RIG_VERIFY_GUARD_MODE']) delete env[k];
    const r = spawnSync(process.execPath, [w.hook], { input: JSON.stringify(input), env, encoding: 'utf8' });
    return r.stdout.trim() ? JSON.parse(r.stdout) : null;
  };
  assert.ok(fromFixture('unverified-edit.jsonl'));
  assert.strictEqual(fromFixture('edit-then-passing-test.jsonl'), null);
  assert.match(fromFixture('edit-then-failing-test.jsonl').hookSpecificOutput.additionalContext, /failed/);
  assert.ok(fromFixture('injected-entries-after-edit.jsonl'), 'truncated tail + injected entries still evaluate the turn');
});
