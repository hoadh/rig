/**
 * Cleanup of kit pieces the kit no longer ships, applied when re-installing over an older install:
 * - Hook registrations in settings.json whose command runs a retired kit hook file.
 *   Only the kit command form is matched (`node <root>/.claude/hooks/<name>.cjs`, where root is
 *   "$HOME", "$CLAUDE_PROJECT_DIR", ~, an absolute path or relative), so a user's own hook
 *   elsewhere is never removed.
 * - Retired kit files under the target `.claude/` dir (exact known paths only), plus the
 *   directories they leave empty. A retired hook file is kept while a settings file still runs it
 *   in a form the stripper does not remove, so no registration is left pointing at a missing file.
 * When a release renames or drops a shipped hook or file, add it to the lists below.
 */
const path = require('path');

// Hook names (without `.cjs`) under `.claude/hooks/` that the kit no longer ships.
// Replaced by native Claude Code features (permissions rules, plan/task tooling); see
// docs/devlog/261016-replace-hooks-with-native-features.md. Stale registrations also block commands
// (scout-block) or auto-allow every Write (descriptive-name).
const RETIRED_KIT_HOOKS = [
  'cook-after-plan-reminder',
  'descriptive-name',
  'plan-format-kanban',
  'post-edit-simplify-reminder',
  'privacy-block',
  'scout-block',
  'session-state',
  'skill-dedup',
  'task-completed-handler',
  'teammate-idle-handler',
  'usage-context-awareness',
];

// Paths relative to the installed `.claude/` dir (~/.claude for global, <project>/.claude for local).
// Support files of the retired hooks above (exact paths only, never globs).
const RETIRED_KIT_FILES = [
  // hook libs
  'hooks/lib/privacy-checker.cjs',
  'hooks/lib/scout-checker.cjs',
  'hooks/lib/session-state-manager.cjs',
  // scout-block modules and vendored ignore parser
  'hooks/scout-block/broad-pattern-detector.cjs',
  'hooks/scout-block/error-formatter.cjs',
  'hooks/scout-block/path-extractor.cjs',
  'hooks/scout-block/pattern-matcher.cjs',
  'hooks/scout-block/vendor/ignore.cjs',
  // scout-block in-tree tests
  'hooks/scout-block/tests/test-broad-pattern-detector.cjs',
  'hooks/scout-block/tests/test-build-command-allowlist.cjs',
  'hooks/scout-block/tests/test-error-formatter.cjs',
  'hooks/scout-block/tests/test-full-flow-edge-cases.cjs',
  'hooks/scout-block/tests/test-monorepo-scenarios.cjs',
  'hooks/scout-block/tests/test-path-extractor.cjs',
  'hooks/scout-block/tests/test-pattern-matcher.cjs',
  // retired hook tests under hooks/tests (incl. rigignore fixtures)
  'hooks/tests/scout-block/broad-pattern-detector.test.cjs',
  'hooks/tests/scout-block/path-extractor.test.cjs',
  'hooks/tests/scout-block/pattern-matcher.test.cjs',
  'hooks/tests/scout-block/scout-checker.test.cjs',
  'hooks/tests/scout-block/fixtures/rigignore-custom.txt',
  'hooks/tests/scout-block/fixtures/rigignore-default.txt',
  'hooks/tests/scout-block/fixtures/rigignore-negation.txt',
  'hooks/tests/test-modularization-hook.cjs',
  'hooks/tests/test-privacy-block.cjs',
  'hooks/tests/test-rigignore.cjs',
  'hooks/tests/test-scout-block.cjs',
  // retired hook unit tests
  'hooks/__tests__/descriptive-name.test.cjs',
  'hooks/__tests__/plan-format-kanban.test.cjs',
  'hooks/__tests__/privacy-block.test.cjs',
  'hooks/__tests__/skill-dedup.test.cjs',
  'hooks/__tests__/task-completed-handler.test.cjs',
  'hooks/__tests__/teammate-idle-handler.test.cjs',
  // scout-block config (no shipped consumer left)
  '.rigignore',
  // NOT listed: session-state/ (runtime dir of the retired hook, no shipped file); remove manually
];

/**
 * Builds the cleanup functions for a set of retired hooks and files.
 * @param {{ hooks?: string[], files?: string[] }} retired hook names and `.claude/`-relative file paths
 */
function createRetiredKitCleanup({ hooks: retiredHooks = [], files: retiredFiles = [] } = {}) {
  const allRetiredFiles = [...retiredHooks.map((name) => `hooks/${name}.cjs`), ...retiredFiles];

  // Root before `.claude/hooks/`: a space-free prefix ("$HOME", %USERPROFILE%, ~, ., /abs, C:\abs),
  // or a fully quoted path that may contain spaces ("C:\Users\John Doe\.claude\hooks\x.cjs")
  const HOOK_NAMES = retiredHooks.join('|');
  const RETIRED_COMMAND = retiredHooks.length === 0 ? null : new RegExp(
    String.raw`^node\s+(?:"[^"]*[/\\]\.claude[/\\]hooks[/\\](${HOOK_NAMES})\.cjs"` +
    String.raw`|"?(?:[^\s"]*"?[/\\])?\.claude[/\\]hooks[/\\](${HOOK_NAMES})\.cjs"?)(\s|$)`
  );

  /** True when the command runs a retired kit hook through the kit's own path form. */
  function isRetiredKitCommand(command) {
    return RETIRED_COMMAND !== null && typeof command === 'string' && RETIRED_COMMAND.test(command.trim());
  }

  function isRetiredHook(hook) {
    return isRetiredKitCommand(typeof hook === 'string' ? hook : hook && hook.command);
  }

  /**
   * Removes retired kit handlers in place; drops entries left without handlers and empty events.
   * @returns {string[]} names of the removed hooks (one per removed handler)
   */
  function stripRetiredKitHooks(settings) {
    const removed = [];
    const nameOf = (command) => {
      const m = command.trim().match(RETIRED_COMMAND);
      return m[1] || m[2];
    };
    for (const [event, entries] of Object.entries(settings.hooks || {})) {
      if (!Array.isArray(entries)) continue;
      const kept = [];
      for (const entry of entries) {
        if (entry.command && isRetiredKitCommand(entry.command)) {
          removed.push(nameOf(entry.command));
          continue;
        }
        if (Array.isArray(entry.hooks)) {
          const hooks = entry.hooks.filter((h) => {
            if (!isRetiredHook(h)) return true;
            removed.push(nameOf(typeof h === 'string' ? h : h.command));
            return false;
          });
          if (hooks.length === 0 && entry.hooks.length > 0) continue;
          entry.hooks = hooks;
        }
        kept.push(entry);
      }
      if (kept.length === 0) delete settings.hooks[event];
      else settings.hooks[event] = kept;
    }
    return removed;
  }

  /** Hook commands in `settings` that the stripper keeps (strings and { command } handlers). */
  function keptHookCommands(settings) {
    const commands = [];
    for (const entries of Object.values((settings && settings.hooks) || {})) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        for (const h of [entry, ...(Array.isArray(entry && entry.hooks) ? entry.hooks : [])]) {
          const command = typeof h === 'string' ? h : h && h.command;
          if (typeof command === 'string' && !isRetiredKitCommand(command)) commands.push(command);
        }
      }
    }
    return commands;
  }

  /** Retired hook names still run by settings.json / settings.local.json in `claudeDir` after stripping. */
  function findStillReferencedRetiredHooks({ claudeDir, fs }) {
    const commands = [];
    for (const name of ['settings.json', 'settings.local.json']) {
      try {
        commands.push(...keptHookCommands(JSON.parse(fs.readFileSync(path.join(claudeDir, name), 'utf8'))));
      } catch {
        // missing or unparsable settings file: nothing to check
      }
    }
    return retiredHooks.filter((hook) =>
      commands.some((command) => new RegExp(String.raw`hooks[/\\]+${hook}\.cjs\b`).test(command)));
  }

  /**
   * Deletes retired kit files under `claudeDir`, then the directories they leave empty.
   * Retired hook files still referenced by a kept settings registration are left in place.
   * @returns {{ deleted: string[], keptReferenced: string[] }} paths relative to claudeDir
   */
  function deleteRetiredKitFiles({ claudeDir, fs, dryRun = false }) {
    const root = path.resolve(claudeDir);
    const keptReferenced = findStillReferencedRetiredHooks({ claudeDir: root, fs }).map((name) => `hooks/${name}.cjs`);
    const deleted = [];
    const parents = new Set();
    for (const rel of allRetiredFiles) {
      if (keptReferenced.includes(rel)) continue;
      const file = path.resolve(root, rel);
      if (!file.startsWith(root + path.sep)) continue; // path guard: never leave the target dir
      let stat;
      try {
        stat = fs.lstatSync(file);
      } catch {
        continue;
      }
      if (!stat.isFile() && !stat.isSymbolicLink()) continue;
      if (!dryRun) fs.unlinkSync(file);
      deleted.push(rel);
      for (let dir = path.dirname(file); dir.startsWith(root + path.sep); dir = path.dirname(dir)) parents.add(dir);
    }
    if (!dryRun) {
      // Deepest first, so a parent is checked after its emptied children
      for (const dir of [...parents].sort((a, b) => b.length - a.length)) {
        try {
          if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
        } catch {
          // already gone or not removable: leave it
        }
      }
    }
    return { deleted, keptReferenced };
  }

  return { isRetiredKitCommand, stripRetiredKitHooks, findStillReferencedRetiredHooks, deleteRetiredKitFiles };
}

const { isRetiredKitCommand, stripRetiredKitHooks, findStillReferencedRetiredHooks, deleteRetiredKitFiles } =
  createRetiredKitCleanup({ hooks: RETIRED_KIT_HOOKS, files: RETIRED_KIT_FILES });

module.exports = {
  RETIRED_KIT_HOOKS, RETIRED_KIT_FILES, createRetiredKitCleanup, isRetiredKitCommand, stripRetiredKitHooks,
  findStillReferencedRetiredHooks, deleteRetiredKitFiles,
};
