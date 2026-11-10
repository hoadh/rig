'use strict';
/**
 * team-member-resolver.cjs - find the Agent Teams member a SubagentStart payload belongs to.
 *
 * Claude Code (agent teams docs, hooks reference) names a team `session-<first 8 chars of the lead's session id>` and keeps
 * `~/.claude/teams/<team>/config.json` with `members: [{ agentId: "<name>@<team>", name, agentType, ... }]`. For an
 * in-process teammate, SubagentStart carries `agent_id` = a unique id (seen live: `a<name>-<hex>`, no `@team`) and
 * `agent_type` = the teammate NAME, not its agent definition. Older builds put `<name>@<team>` in `agent_id`, and some
 * events still carry a deprecated `team_name`. This module tries each source, reads the team config and matches the member
 * by agentId first, then by name, so hooks get the team, the peers and the real agent type (`rig:researcher`).
 * A name match also needs the teammate id shape seen live (`a<name>-...`; a plain subagent id is `a` + hex), so a plain
 * subagent whose type equals a teammate's name (`researcher`) is not taken for that teammate. Split-pane (tmux)
 * teammates are separate sessions and do not fire SubagentStart in the lead, so they never match by name.
 * Read-only; returns null for anything that is not a teammate (plain subagents, the lead, missing or unreadable config).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SAFE_TEAM_NAME = /^[A-Za-z0-9._-]{1,128}$/;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** Team names to try for a payload, most specific first, without duplicates or unsafe names. */
function candidateTeamNames(payload) {
  const names = [];
  const agentId = typeof payload.agent_id === 'string' ? payload.agent_id : '';
  const at = agentId.indexOf('@');
  if (at > 0) names.push(agentId.slice(at + 1));
  if (typeof payload.team_name === 'string') names.push(payload.team_name);
  if (typeof payload.session_id === 'string' && payload.session_id.length >= 8) names.push(`session-${payload.session_id.slice(0, 8)}`);
  return [...new Set(names)].filter((n) => SAFE_TEAM_NAME.test(n) && !n.includes('..'));
}

/**
 * @param {{agent_id?: string, agent_type?: string, session_id?: string, team_name?: string}} payload SubagentStart input
 * @param {{teamsDir?: string}} [opts]
 * @returns {null | {teamName: string, config: object, member: {agentId?: string, name?: string, agentType?: string}}}
 */
function resolveTeamMember(payload, { teamsDir = path.join(os.homedir(), '.claude', 'teams') } = {}) {
  if (!payload || typeof payload !== 'object') return null;
  const agentId = typeof payload.agent_id === 'string' ? payload.agent_id : '';
  const legacyName = agentId.includes('@') ? agentId.slice(0, agentId.indexOf('@')) : null;
  const name = typeof payload.agent_type === 'string' ? payload.agent_type : null;
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : null;
  const nameMatches = (m) => name && m.name === name && agentId.startsWith(`a${name}-`) && m.backendType !== 'tmux';
  for (const teamName of candidateTeamNames(payload)) {
    const config = readJson(path.join(teamsDir, teamName, 'config.json'));
    const members = config && Array.isArray(config.members) ? config.members.filter((m) => m && typeof m === 'object') : [];
    if (!members.length) continue;
    // A stale team dir with the same 8-char prefix belongs to another session
    if (sessionId && typeof config.leadSessionId === 'string' && config.leadSessionId !== sessionId && teamName === `session-${sessionId.slice(0, 8)}`) continue;
    const member = members.find((m) => agentId && m.agentId === agentId)
      || members.find((m) => legacyName && m.name === legacyName)
      || members.find(nameMatches);
    if (member && member.agentType !== 'team-lead') return { teamName, config, member };
  }
  return null;
}

module.exports = { resolveTeamMember, candidateTeamNames };
