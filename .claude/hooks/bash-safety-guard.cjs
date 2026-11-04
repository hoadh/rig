#!/usr/bin/env node
/**
 * Bash Safety Guard - PreToolUse hook (matcher: Bash)
 *
 * Blocks (deny) or asks about Bash commands that are known footguns:
 *   - in-place-edit-symlink: `sed -i` / `perl -i` on a symlink replaces it with a regular file
 *   - process-kill: `pkill -f` patterns that match Claude's own shell, broad kills, kills by
 *     common names (node, python, claude, ...)
 * Rules live in lib/bash-*-rule.cjs; the shared command tokenizer is
 * lib/bash-command-segment-tokenizer.cjs and the rule runner is lib/bash-safety-rule-engine.cjs.
 *
 * Contract:
 *   - Output: one JSON `hookSpecificOutput` with permissionDecision deny|ask, never allow. On
 *     allow nothing is printed and nothing is logged (keeps the hot path fast).
 *   - Fails open: any internal error exits 0 with no output (the crash is logged).
 *   - Logs only deny / ask / crash, as rule id + sha256(command) prefix; never the command text.
 *   - Toggles come from the global ~/.claude/.rig.json only (lib/bash-safety-guard-config.cjs).
 *
 * Exit code: always 0.
 */
try {
  const crypto = require('crypto');
  const fs = require('fs');
  const { logHook, logHookCrash } = require('./lib/hook-logger.cjs');
  const { yieldsToProjectCopy } = require('./lib/global-hook-yields-to-project-copy.cjs');
  const { loadGuardSwitches, isGuardEnabled, isRuleEnabled } = require('./lib/bash-safety-guard-config.cjs');
  const { evaluateCommand } = require('./lib/bash-safety-rule-engine.cjs');

  const HOOK = 'bash-safety-guard';
  const RULES = [
    require('./lib/bash-in-place-edit-symlink-rule.cjs'),
    require('./lib/bash-process-kill-rule.cjs'),
  ];

  const cmdHash = (command) => crypto.createHash('sha256').update(command).digest('hex').slice(0, 12);

  const stdin = fs.readFileSync(0, 'utf-8').trim();
  if (!stdin) process.exit(0);

  let payload;
  try {
    payload = JSON.parse(stdin);
  } catch {
    process.exit(0); // malformed input: never block on it
  }

  const command = payload && payload.tool_input && payload.tool_input.command;
  if (!payload || payload.tool_name !== 'Bash' || typeof command !== 'string' || command === '') process.exit(0);

  // Global copy exits when the project install registers its own copy of this hook.
  if (yieldsToProjectCopy(__filename, payload)) process.exit(0);

  const switches = loadGuardSwitches();
  if (!isGuardEnabled(switches)) process.exit(0);

  const { result, crashes } = evaluateCommand(command, {
    rules: RULES,
    cwd: typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd(),
    isRuleEnabled: (rule) => isRuleEnabled(switches, rule.configKey),
  });

  const hash = cmdHash(command);
  for (const crash of crashes) {
    logHookCrash(HOOK, crash.error, { event: 'PreToolUse', tool: 'Bash', note: `rule:${crash.ruleId} cmd:${hash}` });
  }

  if (result) {
    logHook(HOOK, {
      event: 'PreToolUse',
      tool: 'Bash',
      note: `decision:${result.decision} rule:${result.ruleId} cmd:${hash}`,
      status: result.decision,
    });
    const output = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: result.decision,
        permissionDecisionReason: result.reason,
      },
    };
    // On ask the reason goes to the user; additionalContext carries the remedy to Claude.
    if (result.decision === 'ask' && result.context) output.hookSpecificOutput.additionalContext = result.context;
    // Synchronous write: process.exit right after an async pipe write could truncate the output.
    const line = `${JSON.stringify(output)}\n`;
    try {
      fs.writeSync(1, line);
    } catch {
      process.stdout.write(line);
    }
  }
  process.exit(0);
} catch (error) {
  // Entry crash: fail open.
  try {
    // Only error name + code: messages from fs errors contain paths.
    const tag = `${(error && error.name) || 'Error'}:${(error && error.code) || ''}`;
    require('./lib/hook-logger.cjs').logHookCrash('bash-safety-guard', tag, { event: 'PreToolUse', tool: 'Bash' });
  } catch {
    // logging must never block the tool call
  }
  process.exit(0);
}
