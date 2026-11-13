#!/usr/bin/env node
/**
 * Sets the active plan for the current Antigravity conversation.
 *
 * Usage: node <rig-root>/scripts/set-active-plan-antigravity.cjs <plan-path>
 *
 * Same behavior as plugins/rig/scripts/set-active-plan.cjs, but the session id is the Antigravity conversation
 * id (ANTIGRAVITY_CONVERSATION_ID, present in shell commands run by the agent). It is sanitized exactly like
 * the id the hook adapter passes to the Rig hooks, so both sides share rig-session-<id>.json and the reminder
 * hook picks the plan up. Lives in antigravity/rig/scripts/ and requires ../hooks/ files of the generated plugin.
 */
const path = require('path');
const { writeSessionState, readSessionState } = require('../hooks/lib/rig-config-utils.cjs');
const { sessionIdFrom } = require('../hooks/antigravity-session-id.cjs');

const sessionId = sessionIdFrom(process.env.ANTIGRAVITY_CONVERSATION_ID);
const newPlan = process.argv[2];

const USAGE = ['Usage: node <rig-root>/scripts/set-active-plan-antigravity.cjs <plan-path>', 'Example: ... plans/251207-1030-feature-name'];

if (newPlan === '--help' || newPlan === '-h') {
  console.log(USAGE.join('\n'));
  process.exit(0);
}

if (!newPlan) {
  console.error('Error: Plan path required');
  console.log(USAGE.join('\n'));
  process.exit(1);
}

// Absolute path: a later `cd` must not invalidate the plan.
const absolutePlan = path.resolve(newPlan);

if (!sessionId) {
  console.warn('Warning: ANTIGRAVITY_CONVERSATION_ID not set - session state will not persist');
  console.log(`Would set active plan to: ${absolutePlan}`);
  process.exit(0);
}

const current = readSessionState(sessionId) || {};
if (writeSessionState(sessionId, { ...current, activePlan: absolutePlan, timestamp: Date.now() })) {
  console.log(`Active plan set to: ${absolutePlan}`);
} else {
  console.error('Failed to update session state');
  process.exit(1);
}
