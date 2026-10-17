'use strict';
/**
 * Records the agent child's pid in `<runDir>/agent.pid` so something other than the runner
 * (runner signal handler, `cancel` of a lost run) can kill the agent process tree.
 * Unix: the child is a process-group leader (detached), so pid === pgid and we kill -pid.
 * win32: no groups; `taskkill /T /F /PID`.
 * File format: line 1 = pid, line 2 = process start identity (Unix: `ps -o lstart=` captured right after spawn).
 * Before killing, the live pid's start identity must equal the recorded one: a recycled pid (review M-C) means NO kill (logged to stderr). A gone leader or an
 * identity-less record falls back to "process group still exists" (M4). win32 records no start time (documented limitation:
 * a stale record younger than the last boot could in theory match a recycled pid there).
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pidFile = (dir) => path.join(dir, 'agent.pid');

/** Kill pid and all descendants. @returns {boolean} true when a kill was attempted without error */
function killPidTree(pid, signal = 'SIGTERM') {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    if (process.platform === 'win32') {
      const r = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
      return r.status === 0; // non-zero: process not found / access denied -> nothing was killed
    } else {
      process.kill(-pid, signal);
    }
    return true;
  } catch { return false; } // ESRCH: group already gone
}

/**
 * One `ps -o lstart= -p pid` reading (C locale, TZ=UTC: lstart is TZ-dependent, review M4):
 *  - { state: 'ok', identity }  the process exists
 *  - { state: 'gone' }          clean "no such process" (exit 1, nothing on either stream)
 *  - { state: 'error' }         ps itself failed (spawn error, timeout, unexpected status, or stderr noise)
 * win32 / invalid pid: 'error' (no identity available).
 */
function psReading(pid) {
  if (process.platform === 'win32' || !Number.isInteger(pid) || pid <= 1) return { state: 'error' };
  try {
    const r = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' }, timeout: 5000 });
    if (r.error || r.signal) return { state: 'error' };
    const out = String(r.stdout).trim();
    if (r.status === 0 && out) return { state: 'ok', identity: out };
    if (r.status === 1 && !out && !String(r.stderr).trim()) return { state: 'gone' };
    return { state: 'error' };
  } catch { return { state: 'error' }; }
}

/** Start identity of a live pid, or '' when gone / unavailable / win32. */
function processStartIdentity(pid) {
  const r = psReading(pid);
  return r.state === 'ok' ? r.identity : '';
}

function recordAgentPid(dir, pid) {
  if (pid) fs.writeFileSync(pidFile(dir), `${pid}\n${processStartIdentity(pid)}\n`, { mode: 0o600 });
}

function clearAgentPid(dir) {
  try { fs.unlinkSync(pidFile(dir)); } catch { /* absent */ }
}

/** Process group `pid` still has members (a pgid cannot be reused while its group exists). EPERM = not ours: false. */
function groupExists(pid) {
  try { process.kill(-pid, 0); return true; } catch { return false; }
}

function note(msg) { try { fs.writeSync(2, `${msg}\n`); } catch { /* no stderr */ } }

/**
 * Decide whether the recorded pid is still OUR agent group (review M-C, M4):
 *  - leader alive with the recorded start identity -> yes
 *  - leader alive with a DIFFERENT identity -> recycled pid, no
 *  - recorded identity but ps FAILED twice (not a clean "no such process") -> no kill (R4-L4)
 *  - leader gone (clean empty ps) or no identity recorded (ps without lstart): yes only if the process GROUP still
 *    exists. The caller already rejected records older than the last boot, and the pgid of a live group cannot
 *    be handed to a new process, so a live group under this pgid is the agent's own descendants.
 */
function identityAllowsKill(pid, start) {
  let r = psReading(pid);
  if (start && r.state === 'error') r = psReading(pid); // one retry: a transient ps failure must not decide a kill
  if (start && r.state === 'error') { // R4-L4: cannot tell a dead leader from a recycled pid -> never kill
    note(`agent pid ${pid} not killed: ps failed twice, start identity unknown`);
    return false;
  }
  if (start && r.state === 'ok') {
    if (r.identity === start) return true;
    note(`agent pid ${pid} not killed: start identity ${JSON.stringify(r.identity)} != recorded ${JSON.stringify(start)}`);
    return false;
  }
  if (groupExists(pid)) {
    note(`agent pid ${pid}: ${start ? 'leader gone' : 'no start identity recorded'}; killing the surviving process group`);
    return true;
  }
  note(`agent pid ${pid} not killed: no live leader or process group`);
  return false;
}

/**
 * Kill the recorded agent tree, then forget it. A record older than the last boot is ignored
 * (the pid may belong to an unrelated process after a reboot).
 * @returns {boolean} whether a live tree was signalled
 */
function killRecordedAgent(dir, signal = 'SIGKILL') {
  const file = pidFile(dir);
  let pid = NaN, start = '', mtime = 0;
  try {
    const [l1, l2] = fs.readFileSync(file, 'utf8').split('\n');
    pid = Number.parseInt(l1, 10); start = (l2 || '').trim(); mtime = fs.statSync(file).mtimeMs;
  } catch { return false; }
  clearAgentPid(dir);
  if (mtime < Date.now() - os.uptime() * 1000 - 5000) return false;
  if (process.platform !== 'win32' && !identityAllowsKill(pid, start)) return false;
  return killPidTree(pid, signal);
}

module.exports = { psReading, processStartIdentity, pidFile, killPidTree, recordAgentPid, clearAgentPid, killRecordedAgent };
