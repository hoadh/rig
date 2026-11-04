#!/usr/bin/env node
/**
 * Verify Completion Guard - Stop hook
 *
 * When code was edited this turn and no PASSING test/build/typecheck/lint command ran after the
 * last edit, nudge Claude (default) or block the stop, so "fixed" is never claimed without evidence.
 *
 * Modes (verifyGuard.mode, see lib/verify-guard-config.cjs): remind (default) | block | off.
 *   remind: one hookSpecificOutput.additionalContext nudge per turn (costs one extra model turn).
 *   block:  {"decision":"block"} at most twice per turn (own counter); a line starting
 *           `Verification skipped: <reason>` in the final message lets it through.
 * Always off: RIG_VERIFY_GUARD_MODE=off (set by rig:remote for agent children), headless runs
 * (CLAUDE_CODE_ENTRYPOINT=sdk-*, CLAUDE_CODE_SESSION_ATTENDED=0), and stop_hook_active in remind mode.
 *
 * Fails open: any error, bad input, unreadable or lagging transcript exits 0 with no output.
 * Logs one hook-log entry per evaluated Stop (note: `<result> mode=<m> src=<default|global|project>`).
 * Exit code: always 0.
 */
try {
  const fs = require('fs');
  const { logHook } = require('./lib/hook-logger.cjs');
  const { yieldsToProjectCopy } = require('./lib/global-hook-yields-to-project-copy.cjs');
  const { loadVerifyGuardConfig } = require('./lib/verify-guard-config.cjs');
  const { scanTurn } = require('./lib/turn-edit-and-verify-scanner.cjs');
  const { detectPackageManager, hasPackageScript } = require('./lib/verify-command-detector.cjs');
  const { readCount, incrementCount } = require('./lib/verify-guard-turn-counter.cjs');

  const HOOK = 'verify-completion-guard';
  const MAX_BLOCKS_PER_TURN = 2;
  const MAX_REMINDS_PER_TURN = 1;
  const ESCAPE_LINE = /^Verification skipped:\s*\S/m;
  const MAX_MESSAGE_CHARS = 600;

  const env = process.env;
  const log = (note, status = 'ok') => logHook(HOOK, { event: 'Stop', note, status });

  if (env.RIG_VERIFY_GUARD_MODE === 'off') process.exit(0);
  // Headless / unattended runs (claude -p, SDK, rig:remote workers): a nudge would cost a model turn nobody reads.
  if (/^sdk/.test(env.CLAUDE_CODE_ENTRYPOINT || '') || env.CLAUDE_CODE_SESSION_ATTENDED === '0') process.exit(0);

  const stdin = fs.readFileSync(0, 'utf-8').trim();
  if (!stdin) process.exit(0);
  let payload;
  try {
    payload = JSON.parse(stdin);
  } catch {
    process.exit(0);
  }
  if (!payload || typeof payload !== 'object' || payload.hook_event_name === 'SubagentStop') process.exit(0);
  // Global copy exits when the project install registers its own copy of this hook.
  if (yieldsToProjectCopy(__filename, payload)) process.exit(0);

  const projectDir = env.CLAUDE_PROJECT_DIR || '';
  const config = loadVerifyGuardConfig({ projectDir });
  if (config.mode === 'off') process.exit(0);
  const tag = `mode=${config.mode} src=${config.source}`;
  if (config.rejected.length > 0) log(`extraCommandPatterns rejected: ${config.rejected.join('; ')} ${tag}`);

  const message = typeof payload.last_assistant_message === 'string' ? payload.last_assistant_message : '';
  const remind = config.mode === 'remind';
  // remind: Claude is already continuing from a stop hook, never nudge twice. block: own counter below.
  if (remind && payload.stop_hook_active === true) {
    log(`skip stop-hook-active ${tag}`, 'skip');
    process.exit(0);
  }
  if (!remind && ESCAPE_LINE.test(message)) {
    log(`skip escape-phrase ${tag}`, 'skip');
    process.exit(0);
  }

  const transcript = payload.transcript_path;
  if (typeof transcript !== 'string' || !fs.existsSync(transcript)) {
    log(`skip transcript-missing ${tag}`, 'skip');
    process.exit(0);
  }
  const workDir = projectDir || (typeof payload.cwd === 'string' ? payload.cwd : '');
  const scan = scanTurn(transcript, {
    lastAssistantMessage: message,
    detect: { projectDir: workDir, cwd: typeof payload.cwd === 'string' ? payload.cwd : undefined, extraPatterns: config.extraPatterns },
  });

  const flags = [scan.windowExhausted && 'window-exhausted', scan.boundaryUnclear && 'boundary-unclear'].filter(Boolean).join(' ');
  const suffix = `${flags ? ` ${flags}` : ''} ${tag}`;
  if (scan.lagged) {
    log(`transcript-lag allow${suffix}`, 'skip');
    process.exit(0);
  }
  if (!scan.hasEdit || scan.verified) {
    log(`${scan.hasEdit ? 'verified' : 'no-edits'}${suffix}`);
    process.exit(0);
  }

  const sessionId = payload.session_id || env.RIG_SESSION_ID || '';
  const turnKey = scan.turnKey || String(payload.prompt_id || 'unknown-turn');
  const issued = readCount(sessionId, turnKey);
  const cap = remind ? MAX_REMINDS_PER_TURN : MAX_BLOCKS_PER_TURN;
  if (issued >= cap) {
    log(`${remind ? 'remind-cap' : 'block-cap'} allow${suffix}`, 'skip');
    process.exit(0);
  }

  // Nudge text: names a failed last check; hints the project's own test command when known.
  const pm = detectPackageManager(workDir);
  const hint = pm && hasPackageScript(workDir, 'test') ? ` (e.g. \`${pm} test\`)` : '';
  let text = scan.failedCheck
    ? `Code was edited this turn and the last check \`${scan.failedCheck}\` failed. Fix it or report the failure; do not claim the work is fixed.`
    : `Code was edited this turn but no passing test/build/typecheck/lint ran after the last edit. Run the project's verification${hint} and report the actual result, or say plainly that it was not verified. Do not claim the work is fixed or done without evidence.`;
  if (!remind) text += ' If verification is impossible, reply with a line starting `Verification skipped: <reason>`.';
  text = text.slice(0, MAX_MESSAGE_CHARS);

  incrementCount(sessionId, turnKey);
  log(`unverified${scan.failedCheck ? ' last-check-failed' : ''}${suffix}`);
  const output = remind
    ? { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: text } }
    : { decision: 'block', reason: text };
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exit(0);
} catch (err) {
  try {
    require('./lib/hook-logger.cjs').logHookCrash('verify-completion-guard', err, { event: 'Stop' });
  } catch {
    // logging must never break the hook
  }
  process.exit(0);
}
