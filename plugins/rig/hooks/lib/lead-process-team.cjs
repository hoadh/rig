'use strict';
/**
 * lead-process-team.cjs - find this session's Agent Team by the `claude` process instead of the session id.
 *
 * After `/resume`, Claude Code builds the team from a NEW id (`session-<new 8>`, `leadSessionId` = new id) while hook
 * payloads keep the original `session_id`, so a `session-<8>` lookup misses it. The team config also records
 * `leadProcess: { pid, pidSpace, procStart }` (seen live, 2.1.322 on Linux: `pidSpace` "<hostname>#pid:[<ns inode>]",
 * `procStart` = field 22 of `/proc/<pid>/stat`). Claude Code runs a hook command as its direct child (probed live: the
 * hook's parent is `claude`), so the team whose `leadProcess.pid` is `process.ppid` is this session's team. Only the
 * direct parent counts: a nested `claude -p` (whose parent chain includes an outer `claude`) never takes the outer
 * session's team, and no process tree is walked. If a platform ran hooks through a shell, the lookup misses and the
 * hooks behave as before (fail open).
 *
 * isLeadAlive answers the other question: is a config's lead process still running? Linux `/proc/<pid>/stat` and its
 * start time, elsewhere `process.kill(pid, 0)`. Used to drop a config left over from before `/resume`.
 * Read-only; every failure returns null ("unknown"), never throws.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SAFE_TEAM_NAME = /^[A-Za-z0-9._-]{1,128}$/;

/** Fields of `/proc/<pid>/stat` after the `(comm)` part: index 0 = field 3 (state), 19 = field 22 (starttime). */
function procStatFields(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  } catch {
    return null;
  }
}

/** Linux start time (clock ticks since boot, as a string) of `pid`; null elsewhere or on failure. */
function procStart(pid, platform = process.platform) {
  if (platform !== 'linux') return null;
  const fields = procStatFields(pid);
  return fields && /^\d+$/.test(fields[19] || '') ? fields[19] : null;
}

/** `<hostname>#pid:[<inode>]` as Claude Code records it (Linux), or null. */
function ownPidSpace(platform = process.platform) {
  if (platform !== 'linux') return null;
  try { return `${os.hostname()}#${fs.readlinkSync('/proc/self/ns/pid')}`; } catch { return null; }
}

/** The config's `leadProcess` when usable here: integer pid, and no recorded `pidSpace` other than ours. */
function leadOf(config, pidSpace) {
  const lead = config && typeof config.leadProcess === 'object' && config.leadProcess ? config.leadProcess : null;
  if (!lead || !Number.isInteger(lead.pid) || lead.pid < 1) return null;
  if (typeof lead.pidSpace === 'string' && pidSpace && lead.pidSpace !== pidSpace) return null;
  return lead;
}

/** A numeric recorded `procStart` that differs from the live one means the pid was reused. */
function startMismatch(lead, startOf) {
  if (!/^\d+$/.test(String(lead.procStart ?? ''))) return false;
  const live = startOf(lead.pid);
  return live != null && String(live) !== String(lead.procStart);
}

/**
 * Is the config's lead process still running? true / false, or null when unknown (no usable `leadProcess`, another
 * pid namespace, or no way to tell). `kill(pid, 0)`: ESRCH = gone, EPERM = alive under another user.
 */
function isLeadAlive(config, {
  pidSpace = ownPidSpace(), startOf = procStart, kill = process.kill.bind(process), platform = process.platform,
  procExists = (pid) => procStatFields(pid) !== null,
} = {}) {
  const lead = leadOf(config, pidSpace);
  if (!lead) return null;
  if (platform === 'linux') return procExists(lead.pid) && !startMismatch(lead, startOf);
  try {
    kill(lead.pid, 0);
    return true;
  } catch (e) {
    if (e && e.code === 'ESRCH') return false;
    return e && e.code === 'EPERM' ? true : null;
  }
}

/**
 * The one team whose `leadProcess` is the hook's parent (`claude`), or null (none, several, unreadable).
 * @returns {null | {teamName: string, config: object}}
 */
function teamByLeadProcess({ teamsDir = path.join(os.homedir(), '.claude', 'teams'), parentPid = process.ppid, startOf = procStart, pidSpace } = {}) {
  let names;
  try { names = fs.readdirSync(teamsDir); } catch { return null; }
  let space;
  const found = [];
  for (const teamName of names) {
    if (!SAFE_TEAM_NAME.test(teamName) || teamName.includes('..')) continue;
    let config;
    try { config = JSON.parse(fs.readFileSync(path.join(teamsDir, teamName, 'config.json'), 'utf8')); } catch { continue; }
    if (!config || typeof config !== 'object' || !config.leadProcess) continue;
    if (space === undefined) space = pidSpace === undefined ? ownPidSpace() : pidSpace;
    const lead = leadOf(config, space);
    if (lead && lead.pid === parentPid && !startMismatch(lead, startOf)) found.push({ teamName, config });
  }
  return found.length === 1 ? found[0] : null;
}

module.exports = { isLeadAlive, ownPidSpace, procStart, teamByLeadProcess };
