#!/usr/bin/env node
/**
 * SessionStart Hook - Initializes session environment with project detection
 *
 * Fires: Once per session (startup, resume, clear, compact)
 * Purpose: Load config, detect project info, persist to env vars, output context
 *
 * Exit Codes:
 *   0 - Success (non-blocking, allows continuation)
 *
 * Core detection logic extracted to lib/project-detector.cjs (pure, testable module).
 */

// Crash wrapper
try {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const {
    loadConfig,
    writeEnv,
    writeSessionState,
    resolvePlanPath,
    getReportsPath,
    resolveNamingPattern,
    extractTaskListId,
    isHookEnabled
  } = require('./lib/rig-config-utils.cjs');
  const { createHookTimer, logHookCrash } = require('./lib/hook-logger.cjs');
  const { pruneStaleState } = require('./lib/plugin-data-dir.cjs');
  const { buildReminderContext, clearReminderState } = require('./lib/context-builder.cjs');
  const { yieldTarget, isPluginCopy } = require('./lib/global-hook-yields-to-project-copy.cjs');

  // Early exit if hook disabled in config
  if (!isHookEnabled('session-init')) {
    process.exit(0);
  }

  // Import shared project detection logic
  const {
    detectProjectType,
    detectPackageManager,
    detectFramework,
    getGitBranch,
    getGitRoot,
    samePath,
    buildContextOutput
  } = require('./lib/project-detector.cjs');

/**
 * Detect if this session is running inside an Agent Team.
 * Scans ~/.claude/teams/ for active team configs and checks membership.
 * Note: Returns first team found — Claude Code supports one team per session.
 * Note: Team lifecycle (creation/cleanup) is managed by Claude Code, not this hook.
 * @returns {{ teamName: string, memberCount: number } | null}
 */
function detectAgentTeam() {
  try {
    const teamsDir = path.join(os.homedir(), '.claude', 'teams');
    if (!fs.existsSync(teamsDir)) return null;

    const teams = fs.readdirSync(teamsDir, { withFileTypes: true });
    for (const entry of teams) {
      if (!entry.isDirectory()) continue;
      const configPath = path.join(teamsDir, entry.name, 'config.json');
      if (!fs.existsSync(configPath)) continue;
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.members && config.members.length > 0) {
          return { teamName: entry.name, memberCount: config.members.length };
        }
      } catch { /* skip malformed configs */ }
    }
    return null;
  } catch {
    return null;
  }
}

const GLOBAL_COPY_NOTICE = 'Rig plugin is installed but the 1.x Rig hooks in ~/.claude are still registered, so the 1.x hooks run and the plugin hooks yield. ' +
  'Remove the 1.x global hooks or run the migrator when available.';

// additionalContext is capped by Claude Code (10,000 characters); stay inside it.
const CORE_RULES_MAX_CHARS = 10000;
const CONTEXT_MAX_CHARS = 10000;

/**
 * Reads plugins/rig/rules/core-rules.md when this hook runs from a plugin install.
 * @returns {string} rules text capped at CORE_RULES_MAX_CHARS, or '' (not a plugin, missing file)
 */
function readPluginCoreRules() {
  try {
    if (!isPluginCopy(__filename)) return '';
    const text = fs.readFileSync(path.join(__dirname, '..', 'rules', 'core-rules.md'), 'utf8').trim();
    return text.length > CORE_RULES_MAX_CHARS ? text.slice(0, CORE_RULES_MAX_CHARS) : text;
  } catch {
    return '';
  }
}

/**
 * Plugin mode only: keep ~/.claude/rig/runtime (remote worker, statusline) in step with this plugin version.
 * The source is this hook's own plugin root, never env or a registry scan. A failure (read-only home, partial
 * checkout) must not block the session, so it is logged and ignored; readers fail closed without VERSION.
 */
function refreshRuntimeCopy() {
  try {
    if (!isPluginCopy(__filename)) return;
    const { copyRuntime } = require('./lib/runtime-copy-to-user-dir.cjs');
    copyRuntime({ pluginRoot: path.resolve(__dirname, '..') });
  } catch (error) {
    logHookCrash('session-init', error, { event: 'SessionStart', note: 'runtime-copy' });
  }
}

/**
 * Main hook execution
 */
async function main() {
  const timer = createHookTimer('session-init', { event: 'SessionStart' });
  try {
    const stdin = fs.readFileSync(0, 'utf-8').trim();
    const data = stdin ? JSON.parse(stdin) : {};
    // Global copy exits when the project install runs this same hook.
    const yielded = yieldTarget(__filename, data);
    if (yielded === 'global') {
      // The plugin copy of every other hook yields silently too; say why once, at session start.
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: GLOBAL_COPY_NOTICE } }));
      process.exit(0);
    }
    if (yielded) process.exit(0);
    pruneStaleState();
    refreshRuntimeCopy();
    const envFile = process.env.CLAUDE_ENV_FILE;
    const source = data.source || 'unknown';
    const sessionId = data.session_id || null;

    const config = loadConfig();

    const detections = {
      type: detectProjectType(config.project?.type),
      pm: detectPackageManager(config.project?.packageManager),
      framework: detectFramework(config.project?.framework)
    };

    // Resolve plan - returns { path, resolvedBy }. Pass the session id so a resumed or
    // compacted session keeps the plan set by set-active-plan.cjs (a new session has no state yet)
    const resolved = resolvePlanPath(sessionId, config);

    // CRITICAL FIX: Only persist explicitly-set plans to session state
    // Branch-matched plans are "suggested" - stored separately, not as activePlan
    // This prevents stale plan pollution on fresh sessions
    if (sessionId) {
      writeSessionState(sessionId, {
        sessionOrigin: process.cwd(),
        // Only session-resolved plans are truly "active"
        activePlan: resolved.resolvedBy === 'session' ? resolved.path : null,
        // Track suggested plan separately (for UI hints, not for report paths)
        suggestedPlan: resolved.resolvedBy === 'branch' ? resolved.path : null,
        timestamp: Date.now(),
        source
      });
      // Context was (re)started: let the next prompt emit the plan/naming reminder again
      clearReminderState(sessionId);
    }

    // Compute base directory for absolute paths (Issue #327: use CWD for subdirectory support)
    // Git root is only shown for reference; CWD determines where files are created
    const baseDir = process.cwd();

    // Reports path only uses active plans, not suggested ones.
    // baseDir makes the result absolute-safe: an absolute session plan path is not re-joined
    const reportsPath = getReportsPath(resolved.path, resolved.resolvedBy, config.plan, config.paths, baseDir);

    // Extract task list ID for Claude Code Tasks coordination (shared helper)
    const taskListId = extractTaskListId(resolved);

    const gitBranch = getGitBranch();
    const gitRoot = getGitRoot();

    // Compute resolved naming pattern (date + issue resolved, {slug} kept as placeholder)
    const namePattern = resolveNamingPattern(config.plan, gitBranch);

    // Only variables something reads: hooks (subagent-init, dev-rules-reminder,
    // team-context-inject), set-active-plan.cjs, skills that run Bash with them,
    // and Claude Code itself (CLAUDE_CODE_TASK_LIST_ID)
    if (envFile) {
      writeEnv(envFile, 'RIG_SESSION_ID', sessionId || '');
      writeEnv(envFile, 'RIG_PLAN_DATE_FORMAT', config.plan.dateFormat);

      // Resolved naming pattern, e.g. "251212-1830-GH-88-{slug}"; agents substitute {slug}
      writeEnv(envFile, 'RIG_NAME_PATTERN', namePattern);
      writeEnv(envFile, 'RIG_ACTIVE_PLAN', resolved.resolvedBy === 'session' ? resolved.path : '');

      // Task list ID = plan directory name (shared across sessions working on the same plan)
      if (taskListId) {
        writeEnv(envFile, 'CLAUDE_CODE_TASK_LIST_ID', taskListId);
      }

      // Absolute paths based on CWD for subdirectory workflow support (Issue #327)
      writeEnv(envFile, 'RIG_REPORTS_PATH', reportsPath);
      writeEnv(envFile, 'RIG_PLANS_PATH', path.resolve(baseDir, config.paths.plans));
      writeEnv(envFile, 'RIG_PROJECT_ROOT', baseDir);
      writeEnv(envFile, 'RIG_GIT_BRANCH', gitBranch || '');
    }

    // Everything below is collected and printed once as additionalContext JSON.
    const out = [];

    // Agent Teams detection
    const teamInfo = detectAgentTeam();

    out.push(`Session ${source}. ${buildContextOutput(config, detections, resolved, gitRoot)}`);

    // Static paths, printed once per session start (the per-prompt reminder no longer repeats them)
    try {
      const { sections } = buildReminderContext({
        sessionId, config, baseDir: process.env.CLAUDE_PROJECT_DIR || process.cwd()
      });
      out.push(sections.paths.join('\n').trimEnd());
    } catch (e) {
      // paths are a convenience; never fail session start over them
    }

    // Agent Teams: Show team context if running inside a team (uses cached result)
    if (teamInfo) {
      out.push(`[i] Agent Team detected: "${teamInfo.teamName}" (${teamInfo.memberCount} members)`);
      out.push(`    Team config: ~/.claude/teams/${teamInfo.teamName}/config.json`);
      out.push(`    Use /rig:team skill for orchestration templates.`);
    }

    // Info: Show git root when running from subdirectory (Issue #327: now supported)
    if (gitRoot && !samePath(gitRoot, process.cwd())) {
      out.push(`📁 Subdirectory mode: Plans/docs will be created in current directory`);
      out.push(`   Git root: ${gitRoot}`);
    }

    // MITIGATION: Issue #277 - Auto-compact can bypass AskUserQuestion approval gates
    // When context is compacted mid-workflow, the summarization may lose "pending approval" state.
    // This warning reminds Claude to verify if user approval was pending before proceeding.
    // Upstream bug: Claude Code CLI should preserve pending interactive state during compaction.
    if (source === 'compact') {
      out.push(`\n⚠️ CONTEXT COMPACTED - APPROVAL STATE CHECK:`);
      out.push(`If you were waiting for user approval via AskUserQuestion (e.g., Step 4 review gate),`);
      out.push(`you MUST re-confirm with the user before proceeding. Do NOT assume approval was given.`);
      out.push(`Use AskUserQuestion to verify: "Context was compacted. Please confirm approval to continue."`);
    }

    if (config.assertions?.length > 0) {
      out.push(`\nUser Assertions:`);
      config.assertions.forEach((assertion, i) => {
        out.push(`  ${i + 1}. ${assertion}`);
      });
    }

    // Plugin mode only: a plugin cannot ship .claude/rules, so inject the core rules here.
    // File installs (1.x) get them natively from .claude/rules/.
    const coreRules = readPluginCoreRules();
    if (coreRules) out.push(`\n${coreRules}`);

    // Hard cap on the whole context: the rules are already capped, so only an unusually long
    // assertion list or path block can reach it; the tail (lowest priority) is what gets cut.
    const context = out.join('\n');
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context.length > CONTEXT_MAX_CHARS ? context.slice(0, CONTEXT_MAX_CHARS) : context }
    }));

    timer.end({ status: 'ok', exit: 0, note: source || 'session-start' });
    process.exit(0);
  } catch (error) {
    console.error(`SessionStart hook error: ${error.message}`);
    logHookCrash('session-init', error, { event: 'SessionStart' });
    process.exit(0);
  }
  }

  main();
} catch (e) {
  try {
    const { logHookCrash } = require('./lib/hook-logger.cjs');
    logHookCrash('session-init', e, { event: 'SessionStart' });
  } catch (_) {}
  process.exit(0); // fail-open
}
