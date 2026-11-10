#!/usr/bin/env node
/**
 * Tests for lead-process-team and the resolver's resumed-session path.
 * Layout seen live 2026-11-10 after `/resume` (Claude Code 2.1.322): hooks get session_id 74270464..., the team is
 * `session-f8f9981b` with `leadSessionId: f8f9981b...` and `leadProcess: {pid, pidSpace, procStart}` of the running
 * `claude`, which is the hook's direct parent (probed live).
 */
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lpt = require('../lead-process-team.cjs');
const { resolveTeamMember, sessionTeam } = require('../team-member-resolver.cjs');

const roots = [];
after(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));
/** teams: { [teamName]: config } -> teamsDir */
function mkTeams(teams) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-lpt-'));
  roots.push(dir);
  for (const [name, config] of Object.entries(teams)) {
    fs.mkdirSync(path.join(dir, name), { recursive: true });
    fs.writeFileSync(path.join(dir, name, 'config.json'), typeof config === 'string' ? config : JSON.stringify(config));
  }
  return dir;
}

const OLD_SID = '74270464-4fad-4ef6-bbc3-993a98a312ba';
const NEW_SID = 'f8f9981b-8bfb-4596-8ef2-2acb7236d984';
const CLAUDE_PID = 142276;
const SPACE = 'rock#pid:[4026531836]';
const lead = (team) => ({ agentId: `team-lead@${team}`, name: 'team-lead', agentType: 'team-lead', backendType: 'in-process' });
const mate = (team, name = 'researcher-1') => ({ agentId: `${name}@${team}`, name, agentType: 'rig:researcher', backendType: 'in-process' });
const leadProcess = (pid = CLAUDE_PID, procStart = '13576414', pidSpace = SPACE) => ({ pid, pidSpace, procStart });
const resumedTeam = (lp = leadProcess()) => ({
  name: 'session-f8f9981b', leadSessionId: NEW_SID, leadProcess: lp, members: [lead('session-f8f9981b'), mate('session-f8f9981b')],
});
const oldTeam = (lp) => ({ name: 'session-74270464', leadSessionId: OLD_SID, leadProcess: lp, members: [lead('session-74270464'), mate('session-74270464')] });
const alivePids = new Set([CLAUDE_PID]);
const live = { parentPid: CLAUDE_PID, startOf: () => '13576414', pidSpace: SPACE, isAlive: (c) => (c.leadProcess ? alivePids.has(c.leadProcess.pid) : null) };
const payload = { session_id: OLD_SID, agent_id: 'aresearcher-1-d003b56ff686329c', agent_type: 'researcher-1' };

describe('lead-process-team', () => {
  it('real process on Linux: the hook parent has a start time and our pid space has the recorded shape', { skip: process.platform !== 'linux' }, () => {
    assert.match(String(lpt.procStart(process.ppid)), /^\d+$/);
    assert.match(String(lpt.ownPidSpace()), /^.+#pid:\[\d+\]$/);
    assert.strictEqual(lpt.isLeadAlive({ leadProcess: { pid: process.pid, procStart: lpt.procStart(process.pid), pidSpace: lpt.ownPidSpace() } }), true);
  });
  it('isLeadAlive: running, exited, reused pid, other pid namespace, unknown', () => {
    const linux = { platform: 'linux', pidSpace: SPACE, startOf: () => '13576414', procExists: (pid) => pid === CLAUDE_PID };
    assert.strictEqual(lpt.isLeadAlive(resumedTeam(), linux), true);
    assert.strictEqual(lpt.isLeadAlive(resumedTeam(leadProcess(999)), linux), false, 'exited');
    assert.strictEqual(lpt.isLeadAlive(resumedTeam(leadProcess(CLAUDE_PID, '1')), linux), false, 'pid reused');
    assert.strictEqual(lpt.isLeadAlive(resumedTeam(leadProcess(CLAUDE_PID, 'v2:abc')), linux), true, 'non-numeric procStart is not compared');
    assert.strictEqual(lpt.isLeadAlive(resumedTeam(leadProcess(999, '1', 'box#pid:[1]')), linux), null, 'another pid namespace: unknown');
    assert.strictEqual(lpt.isLeadAlive({ members: [] }, linux), null);
    const err = (code) => () => { const e = new Error(code); e.code = code; throw e; };
    assert.strictEqual(lpt.isLeadAlive(resumedTeam(), { platform: 'darwin', kill: () => true }), true);
    assert.strictEqual(lpt.isLeadAlive(resumedTeam(), { platform: 'darwin', kill: err('ESRCH') }), false);
    assert.strictEqual(lpt.isLeadAlive(resumedTeam(), { platform: 'win32', kill: err('EPERM') }), true);
    assert.strictEqual(lpt.isLeadAlive(resumedTeam(), { platform: 'win32', kill: err('EINVAL') }), null);
  });
  it('teamByLeadProcess: only the hook parent counts; one match, else null', () => {
    const opts = { parentPid: CLAUDE_PID, startOf: () => '13576414', pidSpace: SPACE };
    const dir = mkTeams({ 'session-f8f9981b': resumedTeam(), 'session-11111111': resumedTeam(leadProcess(777)), 'bad..x': resumedTeam(), 'session-junk': '{' });
    assert.strictEqual(lpt.teamByLeadProcess({ teamsDir: dir, ...opts }).teamName, 'session-f8f9981b');
    assert.strictEqual(lpt.teamByLeadProcess({ teamsDir: dir, ...opts, parentPid: 555 }), null, 'nested claude -p: its parent is the inner claude');
    assert.strictEqual(lpt.teamByLeadProcess({ teamsDir: dir, ...opts, startOf: () => '1' }), null, 'pid reused');
    assert.strictEqual(lpt.teamByLeadProcess({ teamsDir: dir, ...opts, pidSpace: 'other#pid:[2]' }), null, 'other pid namespace');
    assert.strictEqual(lpt.teamByLeadProcess({ teamsDir: mkTeams({ a: resumedTeam(), b: resumedTeam() }), ...opts }), null, 'ambiguous');
    const one = mkTeams({ 'session-00000001': resumedTeam(leadProcess(1)) });
    assert.strictEqual(lpt.teamByLeadProcess({ teamsDir: one, ...opts, parentPid: 1 }).teamName, 'session-00000001', 'claude as pid 1 (container)');
    assert.strictEqual(lpt.teamByLeadProcess({ teamsDir: path.join(one, 'missing') }), null);
  });
});

describe('resolver after /resume', () => {
  it('resolveTeamMember finds the teammate in the team named from the new id', () => {
    const r = resolveTeamMember(payload, { teamsDir: mkTeams({ 'session-f8f9981b': resumedTeam() }), leadProcess: live });
    assert.strictEqual(r.teamName, 'session-f8f9981b');
    assert.strictEqual(r.member.agentType, 'rig:researcher');
  });
  it('a config left over from before /resume (its claude exited) does not win by name', () => {
    const dir = mkTeams({ 'session-74270464': oldTeam(leadProcess(999)), 'session-f8f9981b': resumedTeam() });
    assert.strictEqual(resolveTeamMember(payload, { teamsDir: dir, leadProcess: live }).teamName, 'session-f8f9981b');
  });
  it('another session, the lead, plain subagents: null; plain subagents never trigger the lookup', () => {
    assert.strictEqual(resolveTeamMember(payload, { teamsDir: mkTeams({ 'session-f8f9981b': resumedTeam(leadProcess(999)) }), leadProcess: { ...live, isAlive: () => true } }), null);
    const mine = mkTeams({ 'session-f8f9981b': resumedTeam() });
    let looked = false;
    const spy = { ...live, startOf: () => { looked = true; return '13576414'; } };
    assert.strictEqual(resolveTeamMember({ session_id: OLD_SID, agent_id: 'a1b2c3d4e5', agent_type: 'Explore' }, { teamsDir: mine, leadProcess: spy }), null);
    assert.strictEqual(looked, false, 'plain subagent id a<hex>: no lookup');
    assert.strictEqual(resolveTeamMember({ session_id: OLD_SID, agent_id: 'ateam-lead-1', agent_type: 'team-lead' }, { teamsDir: mine, leadProcess: live }), null);
  });
  it('fresh session: the session-<8> team wins; a plain subagent there does not trigger the lookup', () => {
    const team = 'session-74270464';
    const dir = mkTeams({ [team]: oldTeam(leadProcess()), 'session-f8f9981b': resumedTeam() });
    assert.strictEqual(resolveTeamMember(payload, { teamsDir: dir, leadProcess: live }).teamName, team);
    let looked = false;
    const spy = { ...live, startOf: () => { looked = true; return '13576414'; } };
    assert.strictEqual(resolveTeamMember({ session_id: OLD_SID, agent_id: 'aother-1-ab12', agent_type: 'other-1' }, { teamsDir: dir, leadProcess: spy }), null);
    assert.strictEqual(looked, false, 'own live team found: no lookup');
  });
  it('sessionTeam: resumed layout reports the new team; the run left behind is not reported', () => {
    assert.strictEqual(sessionTeam(OLD_SID, { teamsDir: mkTeams({ 'session-f8f9981b': resumedTeam() }), leadProcess: live }).teamName, 'session-f8f9981b');
    const stale = mkTeams({ 'session-74270464': oldTeam(leadProcess(999)) });
    assert.strictEqual(sessionTeam(OLD_SID, { teamsDir: stale, leadProcess: live }), null);
    assert.ok(sessionTeam(OLD_SID, { teamsDir: stale, leadProcess: { ...live, isAlive: () => null } }), 'unknown liveness keeps the team');
    const both = mkTeams({ 'session-74270464': oldTeam(leadProcess(999)), 'session-f8f9981b': resumedTeam() });
    assert.strictEqual(sessionTeam(OLD_SID, { teamsDir: both, leadProcess: live }).teamName, 'session-f8f9981b', 'stale own config falls through');
    const current = mkTeams({ 'session-74270464': oldTeam(leadProcess()) });
    assert.strictEqual(sessionTeam(OLD_SID, { teamsDir: current, leadProcess: live }).teammates.length, 1);
  });
});
