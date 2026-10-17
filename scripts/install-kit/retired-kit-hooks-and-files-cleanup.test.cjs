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
