'use strict';
/**
 * Starts `worker-run-entry.cjs <runDir>` fully detached so it survives the ssh
 * session. win32 -> scheduled task XML (headless S4U default); else tmux (human `tmux attach -t
 * rig-<id>`) when present and not RIG_REMOTE_NO_TMUX; else Node detached
 * spawn with stdio on a log fd. Replies are immediate; callers never wait for a pid.
 */
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const win = require('./windows-scheduled-task-xml.cjs');
const { writeEnvHandoff, discardEnvHandoff } = require('./runner-env-handoff.cjs');

const ENTRY = path.join(__dirname, '..', 'worker-run-entry.cjs');

function hasTmux() {
  if (process.env.RIG_REMOTE_NO_TMUX) return false;
  try { execFileSync('tmux', ['-V'], { stdio: 'ignore' }); return true; } catch { return false; }
}

/** RIG_* settings must reach the runner even when a tmux server already exists with an older env. */
const rigEnvArgs = () => Object.entries(process.env).filter(([k, v]) => k.startsWith('RIG_') && v !== undefined).map(([k, v]) => `${k}=${v}`);

function launchTmux({ runId, runDir, node }) {
  execFileSync('tmux', ['new-session', '-d', '-s', `rig-${runId}`, '-c', runDir, 'env', ...rigEnvArgs(), node, ENTRY, runDir], { stdio: 'pipe' });
  return { method: 'tmux' };
}

function launchNodeDetached({ runDir, node }) {
  const fd = fs.openSync(path.join(runDir, 'runner.log'), 'a', 0o600);
  try {
    const child = spawn(node, [ENTRY, runDir], { detached: true, stdio: ['ignore', fd, fd], windowsHide: true, cwd: runDir });
    child.on('error', () => {}); // surfaces as not-started via state derivation
    child.unref();
  } finally { fs.closeSync(fd); }
  return { method: 'node-detached' };
}

/**
 * @param {{runId:string, runDir:string, target:{node?:string, taskMode?:string}, platform?:string, exec?:Function}} o
 *   platform/exec are test seams (default process.platform / child_process.execFileSync).
 * @returns {{method:string}}
 */
function launchRun({ runId, runDir, target, platform = process.platform, exec }) {
  // Auth env travels via <runDir>/env.json (0600 / run-dir ACL), never argv; the runner loads + deletes it.
  // Same on every OS so token handoff is uniform (a Windows task does not inherit the ssh session env).
  writeEnvHandoff(runDir, process.env);
  try {
    if (platform === 'win32') return win.launchWindowsTask({ runId, runDir, entry: ENTRY, target, ...(exec ? { exec } : {}) });
    const node = target.node || process.execPath;
    return hasTmux() ? launchTmux({ runId, runDir, node }) : launchNodeDetached({ runDir, node });
  } catch (e) {
    discardEnvHandoff(runDir);
    throw e;
  }
}

/** Stop the launcher-side wrapper of a run (cancel of a lost/never-started run). Best effort. */
function stopLaunched(runId) {
  if (process.platform === 'win32') return win.deleteWindowsTask(runId);
  try { execFileSync('tmux', ['kill-session', '-t', `rig-${runId}`], { stdio: 'ignore' }); return true; } catch { return false; }
}

/** Backstop: remove the scheduled task of a finished run (no-op off windows). */
function cleanupFinishedTask(runId) {
  return process.platform === 'win32' ? win.deleteWindowsTask(runId) : false;
}

module.exports = { ENTRY, hasTmux, launchRun, stopLaunched, cleanupFinishedTask };
