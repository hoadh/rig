#!/usr/bin/env node
/**
 * SubagentStart Hook - Injects team context for Agent Team teammates
 *
 * Fires: When a subagent is started (SubagentStart event)
 * Purpose: If the spawned agent is a team member, inject peer info + task summary
 * Design: Non-blocking, fail-open (exit 0 always), no external deps
 */

// Crash wrapper
try {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const { isHookEnabled } = require('./lib/rig-config-utils.cjs');
  const { yieldsToProjectCopy } = require('./lib/global-hook-yields-to-project-copy.cjs');
  const { resolveTeamMember } = require('./lib/team-member-resolver.cjs');
  const { roleLines, teamRuleLines } = require('./lib/teammate-role-context.cjs');

  if (!isHookEnabled('team-context-inject')) {
    process.exit(0);
  }

const TEAMS_DIR = path.join(os.homedir(), '.claude', 'teams');
const TASKS_DIR = path.join(os.homedir(), '.claude', 'tasks');

/**
 * Read and parse JSON file safely
 */
function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Build peer list from team config, excluding the current agent
 */
function buildPeerList(config, currentMember) {
  if (!config?.members?.length) return '';
  const peers = config.members
    .filter(m => m && typeof m === 'object' && m !== currentMember)
    .map(m => `${m.name} (${m.agentType})`)
    .join(', ');
  return peers || 'none';
}

/**
 * Build Rig stack context from environment variables
 * Set by session-init.cjs, available to subagents via SubagentStart
 */
function buildRigContext() {
  const ctx = [];
  const env = process.env;

  if (env.RIG_REPORTS_PATH) ctx.push(`Reports: ${env.RIG_REPORTS_PATH}`);
  if (env.RIG_PLANS_PATH) ctx.push(`Plans: ${env.RIG_PLANS_PATH}`);
  if (env.RIG_PROJECT_ROOT) ctx.push(`Project: ${env.RIG_PROJECT_ROOT}`);
  if (env.RIG_NAME_PATTERN) ctx.push(`Naming: ${env.RIG_NAME_PATTERN}`);
  if (env.RIG_GIT_BRANCH) ctx.push(`Branch: ${env.RIG_GIT_BRANCH}`);
  if (env.RIG_ACTIVE_PLAN) ctx.push(`Active plan: ${env.RIG_ACTIVE_PLAN}`);
  ctx.push('Commits: conventional (feat:, fix:, docs:, refactor:, test:, chore:)');

  return ctx;
}

/**
 * Summarize tasks from team task directory
 */
function summarizeTasks(teamName) {
  const taskDir = path.join(TASKS_DIR, teamName);
  try {
    if (!fs.existsSync(taskDir)) return null;
    const files = fs.readdirSync(taskDir).filter(f => f.endsWith('.json'));
    let pending = 0, inProgress = 0, completed = 0;
    for (const file of files) {
      const task = readJson(path.join(taskDir, file));
      if (!task?.status) continue;
      if (task.status === 'pending') pending++;
      else if (task.status === 'in_progress') inProgress++;
      else if (task.status === 'completed') completed++;
    }
    return { pending, inProgress, completed, total: files.length };
  } catch {
    return null;
  }
}

/**
 * Main hook execution
 */
function main() {
  try {
    const stdin = fs.readFileSync(0, 'utf-8').trim();
    if (!stdin) process.exit(0);

    const payload = JSON.parse(stdin);
    // Global copy exits when the project install runs this same hook.
    if (yieldsToProjectCopy(__filename, payload)) process.exit(0);
    // Teammate? Team from session_id (or a legacy name@team agent_id), member from the team config
    const team = resolveTeamMember(payload, { teamsDir: TEAMS_DIR });
    if (!team) process.exit(0); // Not a teammate (plain subagent, lead, no team config): exit silently
    const { teamName, config, member } = team;

    // Build context
    const peerList = buildPeerList(config, member);
    const tasks = summarizeTasks(teamName);

    const lines = [];
    lines.push(`## Team Context`);
    lines.push(`Team: ${config.name || teamName}`);
    lines.push(`Your peers: ${peerList}`);

    if (tasks) {
      lines.push(`Task summary: ${tasks.pending} pending, ${tasks.inProgress} in progress, ${tasks.completed} completed`);
    }

    // Rig stack context
    const rigCtx = buildRigContext();
    if (rigCtx.length > 0) {
      lines.push('');
      lines.push('## Rig Context');
      lines.push(...rigCtx);
    }

    // Role skill (teammates get no agent skill preloads) and the team rules (only teammates get them)
    const role = roleLines(member.agentType, path.join(__dirname, '..'));
    if (role.length) lines.push('', ...role);
    lines.push('', ...teamRuleLines());

    const output = {
      hookSpecificOutput: {
        hookEventName: "SubagentStart",
        additionalContext: lines.join('\n')
      }
    };

    console.log(JSON.stringify(output));
    process.exit(0);
  } catch (error) {
    // Fail-open: log to stderr, exit cleanly
    if (process.env.RIG_DEBUG) {
      console.error(`[team-context-inject] Error: ${error.message}`);
    }
    process.exit(0);
  }
  }

  main();
} catch (e) {
  // Minimal crash logging (zero deps — only Node builtins)
  try {
    const fs = require('fs');
    const p = require('path');
    const logDir = require('./lib/plugin-data-dir.cjs').logDir(p.join(__dirname, '.logs'));
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: p.basename(__filename, '.cjs'), status: 'crash', error: e.message }) + '\n');
  } catch (_) {}
  process.exit(0); // fail-open
}
