// Run: node --test scripts/install-kit/retired-kit-hooks-and-files-cleanup.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const shipped = require('./retired-kit-hooks-and-files-cleanup.cjs');

// Sample retired set, so the tests do not depend on what the current release retires
const { isRetiredKitCommand, stripRetiredKitHooks, deleteRetiredKitFiles } = shipped.createRetiredKitCleanup({
  hooks: ['privacy-block', 'scout-block', 'skill-dedup', 'descriptive-name', 'task-completed-handler', 'usage-context-awareness'],
  files: ['.rigignore', 'session-state/.gitkeep', 'hooks/scout-block/error-formatter.cjs', 'hooks/scout-block/vendor/ignore.cjs'],
});

test('shipped lists: every entry is a safe relative path, empty lists match nothing', () => {
  for (const rel of shipped.RETIRED_KIT_FILES) assert.ok(!path.isAbsolute(rel) && !rel.split(/[/\\]/).includes('..'), rel);
  if (shipped.RETIRED_KIT_HOOKS.length === 0) {
    assert.ok(!shipped.isRetiredKitCommand('node .claude/hooks/.cjs'));
    assert.ok(!shipped.isRetiredKitCommand('node "$HOME/.claude/hooks/dev-rules-reminder.cjs"'));
  }
});

const REPO_CLAUDE = path.resolve(__dirname, '..', '..', '.claude');

test('shipped guard: no retired hook or file exists in the repo .claude/ (never delete a live file)', () => {
  assert.strictEqual(shipped.RETIRED_KIT_HOOKS.length, 11);
  for (const name of shipped.RETIRED_KIT_HOOKS) {
    assert.ok(!fs.existsSync(path.join(REPO_CLAUDE, 'hooks', `${name}.cjs`)), `hooks/${name}.cjs is shipped`);
  }
  for (const rel of shipped.RETIRED_KIT_FILES) assert.ok(!fs.existsSync(path.join(REPO_CLAUDE, rel)), `${rel} is shipped`);
});

test('shipped lists strip nothing from the repo settings.json', () => {
  const settings = JSON.parse(fs.readFileSync(path.join(REPO_CLAUDE, 'settings.json'), 'utf8'));
  assert.deepStrictEqual(shipped.stripRetiredKitHooks(settings), []);
});

test('shipped lists on a stale global settings shape leave exactly the 4 shipped hooks', () => {
  const cmd = (n) => ({ type: 'command', command: `node "$HOME/.claude/hooks/${n}.cjs"` });
  const settings = { hooks: {
    SessionStart: [{ matcher: 'startup|resume|clear|compact', hooks: [cmd('session-init'), cmd('session-state')] }],
    SubagentStart: [{ matcher: '*', hooks: [cmd('subagent-init'), cmd('team-context-inject')] }],
    SubagentStop: [{ matcher: '^(Plan|planner)$', hooks: [cmd('cook-after-plan-reminder')] }, { hooks: [cmd('session-state')] }],
    UserPromptSubmit: [{ hooks: [cmd('dev-rules-reminder'), cmd('usage-context-awareness')] }],
    PreToolUse: [{ matcher: 'Write', hooks: [cmd('descriptive-name')] },
      { matcher: 'Bash|Glob|Grep|Read|Edit|Write', hooks: [cmd('scout-block'), cmd('privacy-block')] }],
    Stop: [{ hooks: [cmd('session-state')] }],
    PostToolUse: [{ matcher: 'Edit|Write|MultiEdit', hooks: [cmd('post-edit-simplify-reminder'), cmd('plan-format-kanban')] },
      { matcher: 'Bash|Edit|Write|MultiEdit|NotebookEdit', hooks: [cmd('usage-context-awareness')] }],
  } };
  const removed = shipped.stripRetiredKitHooks(settings);
  assert.strictEqual(removed.length, 11);
  assert.strictEqual(new Set(removed).size, 8);
  const left = Object.values(settings.hooks).flat().flatMap((e) => e.hooks.map((h) => h.command)).sort();
  assert.deepStrictEqual(left, ['dev-rules-reminder', 'session-init', 'subagent-init', 'team-context-inject']
    .map((n) => `node "$HOME/.claude/hooks/${n}.cjs"`));
});

test('shipped lists clean a full stale inventory, drop emptied dirs and keep shipped files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retired-kit-full-'));
  try {
    const put = (rel) => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), 'x');
    };
    const stale = [...shipped.RETIRED_KIT_HOOKS.map((n) => `hooks/${n}.cjs`), ...shipped.RETIRED_KIT_FILES];
    const keep = ['hooks/session-init.cjs', 'hooks/dev-rules-reminder.cjs', 'hooks/lib/rig-config-utils.cjs', 'hooks/__tests__/session-init.test.cjs'];
    [...stale, ...keep].forEach(put);

    const { deleted, keptReferenced } = shipped.deleteRetiredKitFiles({ claudeDir: dir, fs });
    assert.deepStrictEqual(keptReferenced, []);
    assert.deepStrictEqual(deleted.sort(), [...stale].sort());
    for (const rel of stale) assert.ok(!fs.existsSync(path.join(dir, rel)), rel);
    for (const sub of ['hooks/scout-block', 'hooks/tests']) assert.ok(!fs.existsSync(path.join(dir, sub)), `${sub} removed`);
    for (const rel of keep) assert.ok(fs.existsSync(path.join(dir, rel)), `${rel} kept`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('matches only the kit command form of a retired hook', () => {
  for (const cmd of [
    'node "$HOME/.claude/hooks/privacy-block.cjs"',
    'node "$CLAUDE_PROJECT_DIR"/.claude/hooks/privacy-block.cjs',
    'node .claude/hooks/privacy-block.cjs',
    'node ~/.claude/hooks/skill-dedup.cjs --flag',
    'node %USERPROFILE%\\.claude\\hooks\\scout-block.cjs',
    'node /Users/someone/.claude/hooks/privacy-block.cjs',
    'node C:\\Users\\someone\\.claude\\hooks\\scout-block.cjs',
    'node "C:\\Users\\John Doe\\.claude\\hooks\\scout-block.cjs"',
    'node "/Users/a b/.claude/hooks/privacy-block.cjs" --x',
  ]) assert.ok(isRetiredKitCommand(cmd), cmd);
  for (const cmd of [
    'node "$HOME/.claude/hooks/dev-rules-reminder.cjs"',
    'node /opt/mine/privacy-block.cjs',
    'node "$HOME/.claude/hooks/privacy-block-custom.cjs"',
    'bash .claude/hooks/scout-block.sh',
    'node "/opt/a b/privacy-block.cjs"',
    'node "/a b/.claude/hooks/privacy-block.cjs.bak"',
  ]) assert.ok(!isRetiredKitCommand(cmd), cmd);
});

test('strips retired kit hooks but keeps user hooks and kept kit hooks', () => {
  const kept = { type: 'command', command: 'node "$HOME/.claude/hooks/dev-rules-reminder.cjs"' };
  const user = { type: 'command', command: 'node /opt/mine/privacy-block.cjs' };
  const settings = {
    hooks: {
      PreToolUse: [
        { matcher: 'Bash|Read', hooks: [{ type: 'command', command: 'node "$HOME/.claude/hooks/scout-block.cjs"' }, user] },
        { matcher: 'Write', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR"/.claude/hooks/descriptive-name.cjs' }] },
      ],
      TaskCompleted: [{ hooks: [{ type: 'command', command: 'node .claude/hooks/task-completed-handler.cjs' }] }],
      UserPromptSubmit: [{ hooks: [kept, { type: 'command', command: 'node ~/.claude/hooks/usage-context-awareness.cjs' }] }],
    },
  };
  const removed = stripRetiredKitHooks(settings);
  assert.deepStrictEqual(settings.hooks.PreToolUse, [{ matcher: 'Bash|Read', hooks: [user] }]);
  assert.ok(!('TaskCompleted' in settings.hooks), 'event left empty is dropped');
  assert.deepStrictEqual(settings.hooks.UserPromptSubmit, [{ hooks: [kept] }]);
  assert.deepStrictEqual(removed.sort(), ['descriptive-name', 'scout-block', 'task-completed-handler', 'usage-context-awareness']);
});

test('deletes known retired files and the dirs they empty, nothing else', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retired-kit-'));
  try {
    const put = (rel) => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), 'x');
    };
    ['hooks/privacy-block.cjs', 'hooks/scout-block/vendor/ignore.cjs', 'hooks/scout-block/error-formatter.cjs', '.rigignore',
      'hooks/dev-rules-reminder.cjs', 'hooks/scout-block/my-notes.txt', 'session-state/abc.json', 'session-state/.gitkeep'].forEach(put);

    assert.deepStrictEqual(deleteRetiredKitFiles({ claudeDir: dir, fs, dryRun: true }).deleted.length, 5);
    assert.ok(fs.existsSync(path.join(dir, 'hooks/privacy-block.cjs')), 'dry run deletes nothing');

    const { deleted, keptReferenced } = deleteRetiredKitFiles({ claudeDir: dir, fs });
    assert.deepStrictEqual(keptReferenced, []);
    assert.deepStrictEqual(deleted.sort(), ['.rigignore', 'hooks/privacy-block.cjs', 'hooks/scout-block/error-formatter.cjs', 'hooks/scout-block/vendor/ignore.cjs', 'session-state/.gitkeep']);
    assert.ok(!fs.existsSync(path.join(dir, 'hooks/scout-block/vendor')), 'emptied dir removed');
    assert.ok(fs.existsSync(path.join(dir, 'hooks/scout-block/my-notes.txt')), 'unknown file kept, so its dir stays');
    assert.ok(fs.existsSync(path.join(dir, 'session-state/abc.json')));
    assert.ok(fs.existsSync(path.join(dir, 'hooks/dev-rules-reminder.cjs')));

    assert.deepStrictEqual(deleteRetiredKitFiles({ claudeDir: dir, fs }).deleted, [], 'second run deletes nothing');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('keeps a retired hook file that a non-kit-form registration still runs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retired-kit-ref-'));
  try {
    fs.mkdirSync(path.join(dir, 'hooks'));
    for (const name of ['privacy-block', 'scout-block']) fs.writeFileSync(path.join(dir, 'hooks', `${name}.cjs`), 'x');
    const settings = { hooks: { PreToolUse: [{ hooks: [
      { type: 'command', command: 'node "$HOME/.claude/hooks/scout-block.cjs"' }, // kit form: stripped, file may go
    ] }] } };
    const local = { hooks: { PreToolUse: [{ hooks: [
      { type: 'command', command: 'bash -c "node \'/Users/a b/.claude/hooks/privacy-block.cjs\'"' }, // not stripped
    ] }] } };
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings));
    fs.writeFileSync(path.join(dir, 'settings.local.json'), JSON.stringify(local));

    const { deleted, keptReferenced } = deleteRetiredKitFiles({ claudeDir: dir, fs });
    assert.deepStrictEqual(keptReferenced, ['hooks/privacy-block.cjs']);
    assert.ok(deleted.includes('hooks/scout-block.cjs'));
    assert.ok(fs.existsSync(path.join(dir, 'hooks/privacy-block.cjs')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
