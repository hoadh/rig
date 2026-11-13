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
 * After `/resume` the team is named from a new id the hooks never see; then the team whose `leadProcess` is this hook's
 * parent `claude` is used, and a config whose lead process has exited is ignored (`lead-process-team.cjs`).
 * Read-only; returns null for anything that is not a teammate (plain subagents, the lead, missing or unreadable config).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const leadProcessTeam = require('./lead-process-team.cjs');

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
  const own = sessionTeamName(payload.session_id);
  if (own) names.push(own);
  return [...new Set(names)].filter((n) => SAFE_TEAM_NAME.test(n) && !n.includes('..'));
}

/**
 * Lead-process options (tests inject them): `parentPid` (the hook's parent, default `process.ppid`), `startOf(pid)`,
 * `pidSpace`, `isAlive(config)` (default `isLeadAlive`).
 */
function leadProcessOptions({ parentPid, startOf, pidSpace, isAlive } = {}) {
  const lookup = { startOf: startOf || leadProcessTeam.procStart };
  if (parentPid !== undefined) lookup.parentPid = parentPid;
  if (pidSpace !== undefined) lookup.pidSpace = pidSpace;
  return { lookup, isAlive: isAlive || ((config) => leadProcessTeam.isLeadAlive(config, pidSpace === undefined ? {} : { pidSpace })) };
}

/**
 * @param {{agent_id?: string, agent_type?: string, session_id?: string, team_name?: string}} payload SubagentStart input
 * @param {{teamsDir?: string, leadProcess?: {parentPid?: number, startOf?: Function, pidSpace?: string, isAlive?: Function}}} [opts]
 * @returns {null | {teamName: string, config: object, member: {agentId?: string, name?: string, agentType?: string}}}
 */
function resolveTeamMember(payload, { teamsDir = path.join(os.homedir(), '.claude', 'teams'), leadProcess } = {}) {
  if (!payload || typeof payload !== 'object') return null;
  const agentId = typeof payload.agent_id === 'string' ? payload.agent_id : '';
  const legacyName = agentId.includes('@') ? agentId.slice(0, agentId.indexOf('@')) : null;
  const name = typeof payload.agent_type === 'string' ? payload.agent_type : null;
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : null;
  const nameMatches = (m) => name && m.name === name && agentId.startsWith(`a${name}-`) && m.backendType !== 'tmux';
  const memberOf = (config) => {
    const members = config && Array.isArray(config.members) ? config.members.filter((m) => m && typeof m === 'object') : [];
    const member = members.find((m) => agentId && m.agentId === agentId)
      || members.find((m) => legacyName && m.name === legacyName)
      || members.find(nameMatches);
    return member && member.agentType !== 'team-lead' ? member : null;
  };
  const { lookup, isAlive } = leadProcessOptions(leadProcess);
  const tried = candidateTeamNames(payload);
  let ownLiveTeam = false;
  for (const teamName of tried) {
    const config = readJson(path.join(teamsDir, teamName, 'config.json'));
    if (!config || !Array.isArray(config.members) || !config.members.length) continue;
    // A stale team dir with the same 8-char prefix belongs to another session
    if (sessionId && typeof config.leadSessionId === 'string' && config.leadSessionId !== sessionId && teamName === `session-${sessionId.slice(0, 8)}`) continue;
    // Left over from before `/resume`: its lead `claude` has exited (no process walk, one /proc read or kill(0))
    if (isAlive(config) === false) continue;
    if (sessionId && config.leadSessionId === sessionId) ownLiveTeam = true;
    const member = memberOf(config);
    if (member) return { teamName, config, member };
  }
  // Resumed session: the team is named from an id the payload does not carry. Only for teammate-shaped ids
  // (`a<name>-...` or legacy `name@team`; a plain subagent id is `a<hex>`) and only when this session has no live team
  // of its own name, so plain subagents of a fresh session never pay for the lookup.
  const teammateShaped = Boolean(legacyName) || Boolean(name && agentId.startsWith(`a${name}-`));
  if (!teammateShaped || ownLiveTeam) return null;
  const team = leadProcessTeam.teamByLeadProcess({ teamsDir, ...lookup });
  if (!team || tried.includes(team.teamName)) return null;
  const member = memberOf(team.config);
  return member ? { teamName: team.teamName, config: team.config, member } : null;
}

/** The team name Claude Code derives for a session (`session-<first 8 chars>`), or null for a short/unsafe id. */
function sessionTeamName(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length < 8) return null;
  const name = `session-${sessionId.slice(0, 8)}`;
  return SAFE_TEAM_NAME.test(name) ? name : null;
}

/**
 * This session's team, when it has teammates: other sessions' dirs, a stale dir with the same 8-char prefix (different
 * `leadSessionId`) and a config whose lead process has exited (left over from before `/resume`) are ignored, and a
 * lead-only config counts as no team. Without a usable `session-<8>` config, the team led by this hook's parent
 * `claude` is used (resumed session).
 * @returns {null | {teamName: string, config: object, teammates: object[]}}
 */
function sessionTeam(sessionId, { teamsDir = path.join(os.homedir(), '.claude', 'teams'), leadProcess } = {}) {
  const ownName = sessionTeamName(sessionId);
  if (!ownName) return null;
  const { lookup, isAlive } = leadProcessOptions(leadProcess);
  let teamName = ownName;
  let config = readJson(path.join(teamsDir, ownName, 'config.json'));
  const usable = config && Array.isArray(config.members)
    && !(typeof config.leadSessionId === 'string' && config.leadSessionId !== sessionId)
    && isAlive(config) !== false;
  if (!usable) {
    const team = leadProcessTeam.teamByLeadProcess({ teamsDir, ...lookup });
    if (!team || !Array.isArray(team.config.members)) return null;
    ({ teamName, config } = team);
  }
  const teammates = config.members.filter((m) => m && typeof m === 'object' && m.agentType !== 'team-lead');
  return teammates.length ? { teamName, config, teammates } : null;
}

module.exports = { resolveTeamMember, candidateTeamNames, sessionTeamName, sessionTeam };
