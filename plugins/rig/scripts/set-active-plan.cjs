#!/usr/bin/env node
/**
 * Update session state with new active plan
 *
 * Usage: rig-set-active-plan <plan-path>   (plugin bin/; file installs: node .claude/bin/rig-set-active-plan)
 *
 * This script updates the session temp file with the new active plan path,
 * allowing subagents to receive the latest plan context via SubagentStart hook.
 *
 * The session temp file (/tmp/rig-session-{id}.json) is the source of truth
 * for plan context within a session. Env vars ($RIG_ACTIVE_PLAN) are just
 * the initial snapshot from session start.
 */

const path = require('path');
const { writeSessionState, readSessionState } = require('../hooks/lib/rig-config-utils.cjs');

const sessionId = process.env.RIG_SESSION_ID;
const newPlan = process.argv[2];

const USAGE = ['Usage: rig-set-active-plan <plan-path>', 'Example: rig-set-active-plan plans/251207-1030-feature-name'];

if (newPlan === '--help' || newPlan === '-h') {
  console.log(USAGE.join('\n'));
  process.exit(0);
}

if (!newPlan) {
  console.error('Error: Plan path required');
  console.log(USAGE.join('\n'));
  process.exit(1);
}

// Issue #335: Resolve to absolute path to support brownfield/subdirectory workflows
// When agent navigates away from session origin, relative paths become invalid
const absolutePlan = path.resolve(newPlan);

if (!sessionId) {
  console.warn('Warning: RIG_SESSION_ID not set - session state will not persist');
  console.log(`Would set active plan to: ${absolutePlan}`);
  process.exit(0);
}

const current = readSessionState(sessionId) || {};
const success = writeSessionState(sessionId, {
  ...current,
  activePlan: absolutePlan,
  timestamp: Date.now()
});

if (success) {
  console.log(`Active plan set to: ${absolutePlan}`);
} else {
  console.error('Failed to update session state');
  process.exit(1);
}
