'use strict';
/**
 * Heartbeat + busy-marker ownership watchdog on a worker thread, so a synchronous git call
 * (execFileSync blocks the main event loop, bounded by safeGit's timeout) cannot freeze it and
 * make a live run look `lost`.
 *   - every tick: touch `<runDir>/heartbeat` (only while we still own the busy marker)
 *   - ownership lost (marker missing or held by another runId): stop heartbeating and drop the
 *     `cancelled` sentinel; the runner aborts at its next checkpoint and the supervisor kills the agent.
 * The main thread writes the first heartbeat synchronously before starting this.
 */
const { Worker, isMainThread, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');

/** One tick. Exported for tests. @returns {'ok'|'lost'} */
function tick({ dir, busyFile, runId }) {
  if (fs.existsSync(path.join(dir, 'exit'))) return 'ok'; // run is finishing: busy release is expected
  let holder = null;
  try { holder = fs.readFileSync(busyFile, 'utf8').trim(); } catch { /* missing marker == not ours */ }
  if (holder !== runId) {
    try { fs.writeFileSync(path.join(dir, 'cancelled'), `${Date.now()} busy-ownership-lost\n`, { flag: 'a', mode: 0o600 }); } catch { /* best effort */ }
    return 'lost';
  }
  try {
    const tmp = path.join(dir, `heartbeat.${process.pid}.t.tmp`);
    fs.writeFileSync(tmp, `${Date.now()}\n`, { mode: 0o600 });
    fs.renameSync(tmp, path.join(dir, 'heartbeat'));
  } catch { /* disk hiccup: next tick */ }
  return 'ok';
}

if (!isMainThread && workerData && workerData.rigHeartbeat) {
  const iv = setInterval(() => { if (tick(workerData) === 'lost') clearInterval(iv); }, workerData.intervalMs);
}

/** @returns {{stop:()=>void}} */
function startHeartbeatThread({ dir, busyFile, runId, intervalMs }) {
  const w = new Worker(__filename, { workerData: { rigHeartbeat: true, dir, busyFile, runId, intervalMs } });
  w.unref();
  w.on('error', () => {}); // heartbeat loss is observable as `lost`; never crash the runner
  return { stop: () => { w.terminate().catch(() => {}); } };
}

module.exports = { startHeartbeatThread, tick };
