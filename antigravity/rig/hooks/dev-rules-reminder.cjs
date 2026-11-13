#!/usr/bin/env node
/**
 * Development Rules Reminder - UserPromptSubmit Hook (Optimized)
 *
 * Every prompt gets one `- Now: <stamp> (tz)` line (the timestamp Naming uses, so plan and
 * report names are never stale). The full block (session, Plan Context, Naming) is emitted
 * only when the plan context or git branch changed since the last emit in this session;
 * the first prompt of a session always emits it. Static paths are printed once by
 * session-init; static guidance lives in the rules files Claude Code loads natively (or is injected by session-init for the plugin).
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

  // Import shared context building logic
  const {
    buildReminderContext,
    shouldEmitReminder,
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
    // Get session ID from hook input or env var
    const sessionId = payload.session_id || process.env.RIG_SESSION_ID || null;

    // Project dir, not the shell's current dir: a `cd` in Bash moves the hook's
    // CWD, which would point plans/reports at a subdirectory (Issue #327 still
    // holds: launching Claude in a subdirectory makes that the project dir)
    const baseDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

    // Use shared context builder with baseDir for absolute paths
    const { sections, signature, nowLine } = buildReminderContext({ sessionId, baseDir });

    // Recently injected (transcript marker) or unchanged plan/branch: only the Now line
    if (wasRecentlyInjected(payload.transcript_path) || !shouldEmitReminder(sessionId, signature)) {
      console.log(nowLine);
      timer.end({ status: 'ok', exit: 0, note: 'now-only' });
      process.exit(0);
    }

    // Paths are static: session-init prints them once
    const content = [...sections.session, ...sections.planContext, ...sections.naming].join('\n');
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
