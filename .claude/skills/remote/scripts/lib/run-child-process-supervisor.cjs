'use strict';
/**
 * Runs the agent / user command as a supervised child: stdout+stderr go to
 * capped files (never to the worker's protocol stdout), hard timeout and
 * cancel polling kill the whole process tree, background grandchildren that
 * keep pipes open cannot hang the run.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const { killPidTree, recordAgentPid, clearAgentPid } = require('./agent-process-registry.cjs');

const LOG_CAP_BYTES = 20 * 1024 * 1024;

/** Append-only writer that stops after `cap` bytes and appends a truncation notice once. */
function createCappedWriter(file, cap = LOG_CAP_BYTES) {
  const fd = fs.openSync(file, 'a', 0o600);
  let written = fs.fstatSync(fd).size, truncated = false;
  return {
    write(chunk) {
      if (truncated) return;
      const room = cap - written;
      const buf = chunk.length > room ? chunk.subarray(0, Math.max(room, 0)) : chunk;
      if (buf.length) { fs.writeSync(fd, buf); written += buf.length; }
      if (chunk.length > room) { fs.writeSync(fd, '\n[log truncated]\n'); truncated = true; }
    },
    close() { try { fs.closeSync(fd); } catch { /* already closed */ } },
  };
}

/** Kill child and descendants. Unix: process group (child is a group leader); win32: taskkill /T. */
function killTree(child, signal = 'SIGTERM') {
  if (!child.pid) return;
  // win32: after exit the pid may be recycled; `taskkill /T /F` would kill an unrelated process tree
  if (process.platform === 'win32' && (child.exitCode !== null || child.signalCode !== null)) return;
  if (!killPidTree(child.pid, signal)) { try { child.kill(signal); } catch { /* gone */ } }
}

/**
 * @param {{cmd:string, argv:string[], cwd:string, env:object, stdinText?:string, logFile:string,
 *   stdoutFile?:string, pidDir?:string, timeoutMs:number, shouldCancel?:()=>boolean, graceMs?:number, pollMs?:number}} o
 * @returns {Promise<{code:number|null, signal:string|null, timedOut:boolean, cancelled:boolean, spawnError:string|null}>}
 */
function superviseChild(o) {
  return new Promise((resolve) => {
    const log = createCappedWriter(o.logFile);
    const out = o.stdoutFile ? createCappedWriter(o.stdoutFile) : log;
    let child;
    try {
      child = spawn(o.cmd, o.argv, { cwd: o.cwd, env: o.env, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      log.close(); if (out !== log) out.close();
      return resolve({ code: null, signal: null, timedOut: false, cancelled: false, spawnError: e.message });
    }
    if (o.pidDir) recordAgentPid(o.pidDir, child.pid); // lets the runner's signal handler / `cancel` kill the tree
    const state = { timedOut: false, cancelled: false, spawnError: null };
    let settled = false, graceTimer = null, drainTimer = null;
    const timers = [];
    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout); timers.forEach(clearInterval); clearTimeout(graceTimer); clearTimeout(drainTimer);
      // Leftover grandchildren must not outlive the run (they could tamper with .git during the push): SIGKILL the group now.
      killTree(child, 'SIGKILL');
      if (o.pidDir) clearAgentPid(o.pidDir);
      log.close(); if (out !== log) out.close();
      resolve({ code, signal, ...state });
    };
    const stop = () => {
      killTree(child, 'SIGTERM');
      graceTimer = setTimeout(() => killTree(child, 'SIGKILL'), o.graceMs ?? 5000);
    };
    child.stdout.on('data', (c) => out.write(c));
    child.stderr.on('data', (c) => log.write(c));
    child.stdin.on('error', () => {}); // child may exit before reading the prompt
    child.stdin.end(o.stdinText || '');
    child.on('error', (e) => { state.spawnError = e.message; finish(null, null); });
    child.on('exit', (code, signal) => { // grandchildren may hold the pipes: do not wait forever for 'close'
      drainTimer = setTimeout(() => finish(code, signal), 1000);
    });
    child.on('close', (code, signal) => finish(code, signal));
    timers.push(setTimeout(() => { state.timedOut = true; stop(); }, o.timeoutMs));
    if (o.shouldCancel) {
      timers.push(setInterval(() => {
        if (!state.cancelled && !state.timedOut && o.shouldCancel()) { state.cancelled = true; stop(); }
      }, o.pollMs ?? 1000));
    }
  });
}

module.exports = { LOG_CAP_BYTES, createCappedWriter, killTree, superviseChild };
