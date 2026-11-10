#!/usr/bin/env node
/** Tests for team-member-resolver: the payload shapes Claude Code sends to SubagentStart for agent-team teammates. */
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveTeamMember, candidateTeamNames } = require('../team-member-resolver.cjs');

const teamsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-teams-'));
after(() => fs.rmSync(teamsDir, { recursive: true, force: true }));
const SESSION = '74270464-4fad-4ef6-bbc3-993a98a312ba';
const TEAM = 'session-74270464';
fs.mkdirSync(path.join(teamsDir, TEAM), { recursive: true });
fs.writeFileSync(path.join(teamsDir, TEAM, 'config.json'), JSON.stringify({
  name: TEAM,
  leadSessionId: SESSION,
  members: [
    { agentId: `team-lead@${TEAM}`, name: 'team-lead', agentType: 'team-lead' },
    { agentId: `rig-live-probe@${TEAM}`, name: 'rig-live-probe', agentType: 'rig:researcher' },
    { agentId: `bob@${TEAM}`, name: 'bob', agentType: 'rig:tester' },
  ],
}));
const opts = { teamsDir };

describe('resolveTeamMember', () => {
  it('current payload (seen live 2026-11-10): team from session_id, member by agent_type = teammate name', () => {
    const r = resolveTeamMember({ session_id: SESSION, agent_id: 'arig-live-probe-fb5e715e4bb7848f', agent_type: 'rig-live-probe' }, opts);
    assert.strictEqual(r.teamName, TEAM);
    assert.strictEqual(r.member.agentType, 'rig:researcher');
  });
  it('legacy payload: agent_id name@team', () => {
    const r = resolveTeamMember({ agent_id: `bob@${TEAM}`, agent_type: 'rig:tester' }, opts);
    assert.strictEqual(r.member.name, 'bob');
  });
  it('deprecated team_name field', () => {
    assert.strictEqual(resolveTeamMember({ team_name: TEAM, agent_id: 'abob-1a2b3c', agent_type: 'bob' }, opts).member.name, 'bob');
    assert.strictEqual(resolveTeamMember({ team_name: TEAM, agent_id: 'x', agent_type: 'bob' }, opts), null, 'name alone is not enough');
  });
  it('plain subagent in the same session is not a teammate, even when its type equals a teammate name', () => {
    assert.strictEqual(resolveTeamMember({ session_id: SESSION, agent_id: 'a123', agent_type: 'Explore' }, opts), null);
    assert.strictEqual(resolveTeamMember({ session_id: SESSION, agent_id: 'a0123456789abcdef', agent_type: 'bob' }, opts), null);
  });
  it('a stale team dir of another session with the same 8-char prefix is ignored', () => {
    assert.strictEqual(resolveTeamMember({ session_id: '74270464-ffff-0000-0000-000000000000', agent_id: 'abob-1a2b', agent_type: 'bob' }, opts), null);
  });
  it('the lead is never returned as a teammate', () => {
    assert.strictEqual(resolveTeamMember({ session_id: SESSION, agent_id: `team-lead@${TEAM}`, agent_type: 'team-lead' }, opts), null);
  });
  it('no team config for the session, empty or garbage payloads: null', () => {
    assert.strictEqual(resolveTeamMember({ session_id: 'ffffffff-0000', agent_type: 'bob' }, opts), null);
    assert.strictEqual(resolveTeamMember({}, opts), null);
    assert.strictEqual(resolveTeamMember(null, opts), null);
    assert.strictEqual(resolveTeamMember({ session_id: 42, agent_id: {}, agent_type: [] }, opts), null);
  });
  it('rejects unsafe team names (path traversal)', () => {
    assert.deepStrictEqual(candidateTeamNames({ agent_id: 'a@../../etc', team_name: 'x/y', session_id: '..' }), []);
    assert.deepStrictEqual(candidateTeamNames({ agent_id: 'bob@t1', team_name: 't1', session_id: SESSION }), ['t1', TEAM]);
  });
});
