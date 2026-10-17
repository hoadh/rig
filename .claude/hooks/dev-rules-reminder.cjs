#!/usr/bin/env node
/**
 * Development Rules Reminder - UserPromptSubmit Hook (Optimized)
 *
 * Injects dynamic context only: date/time, paths, Plan Context and naming.
 * Static guidance lives in .claude/rules/*.md, which Claude Code loads natively.
 *
 * Exit Codes:
 *   0 - Success (non-blocking, allows continuation)
 *
 * Core logic extracted to lib/context-builder.cjs (pure, testable module).
 */

// Crash wrapper
try {
  const fs = require('fs');
  const { createHookTimer, logHookCrash } = require('./lib/hook-logger.cjs');
  const { yieldsToProjectCopy } = require('./lib/global-hook-yields-to-project-copy.cjs');

  // Import shared context building logic
  const {
    buildReminderContext,
    wasRecentlyInjected
  } = require('./lib/context-builder.cjs');
  const { isHookEnabled } = require('./lib/rig-config-utils.cjs');

  // Early exit if hook disabled in config
  if (!isHookEnabled('dev-rules-reminder')) {
    process.exit(0);
  }

// ═══════════════════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const timer = createHookTimer('dev-rules-reminder', { event: 'UserPromptSubmit' });
  try {
    const stdin = fs.readFileSync(0, 'utf-8').trim();
    if (!stdin) {
      timer.end({ status: 'skip', exit: 0, note: 'empty-input' });
      process.exit(0);
    }

    const payload = JSON.parse(stdin);
    // Global copy exits when the project install runs this same hook.
    if (yieldsToProjectCopy(__filename, payload)) process.exit(0);
    if (wasRecentlyInjected(payload.transcript_path)) {
      timer.end({ status: 'skip', exit: 0, note: 'recently-injected' });
      process.exit(0);
    }

    // Get session ID from hook input or env var
    const sessionId = payload.session_id || process.env.RIG_SESSION_ID || null;

    // Project dir, not the shell's current dir: a `cd` in Bash moves the hook's
    // CWD, which would point plans/reports at a subdirectory (Issue #327 still
    // holds: launching Claude in a subdirectory makes that the project dir)
    const baseDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

    // Use shared context builder with baseDir for absolute paths
    const { content } = buildReminderContext({ sessionId, baseDir });

    console.log(content);
    timer.end({ status: 'ok', exit: 0, note: 'context-injected' });
    process.exit(0);
  } catch (error) {
    console.error(`Dev rules hook error: ${error.message}`);
    logHookCrash('dev-rules-reminder', error, { event: 'UserPromptSubmit' });
    process.exit(0);
  }
  }

  main();
} catch (e) {
  try {
    const { logHookCrash } = require('./lib/hook-logger.cjs');
    logHookCrash('dev-rules-reminder', e, { event: 'UserPromptSubmit' });
  } catch (_) {}
  process.exit(0); // fail-open
}
