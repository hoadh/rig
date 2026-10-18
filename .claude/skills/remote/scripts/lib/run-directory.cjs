'use strict';
/**
 * Worker-side run directory: paths, atomic writes, pure state derivation from
 * files (no pid checks anywhere), busy markers and the RunFailure error.
 *
 *   <runsRoot>/<runId>/  run.json task.md heartbeat log result.raw.json
 *                        result.json exit cancelled runner.lock runner.log
 * `exit` is written LAST and atomically; its presence is the only "finished" signal.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const V = require('./identifier-validators.cjs');

const FAILURES = ['prepare', 'lock', 'hooks-tampered', 'owns-violation', 'agent', 'auth', 'ratelimit', 'push', 'timeout', 'cancelled', 'not-started'];
// no heartbeat yet and younger than this -> starting. Must exceed the Windows headless task window
// (StartBoundary +60s, EndBoundary +60s later = 120s) so a late-firing task can never start after `not-started`.
const STARTING_GRACE_MS = 180_000;
const BUSY_HOLDER_GRACE_MS = 5_000; // empty/garbled busy marker younger than this is treated as live
const HEARTBEAT_STALE_MS = Number(process.env.RIG_HEARTBEAT_STALE_MS) || 90_000; // heartbeat older than this -> lost (env: test seam)

/** Error carrying a failure class; runner turns it into result.json + exit. */
class RunFailure extends Error {
  constructor(failure, message, extra = {}) {
    super(message);
    this.name = 'RunFailure';
    this.failure = failure;
    this.extra = extra;
  }
}

const rigHome = () => process.env.RIG_HOME || path.join(os.homedir(), '.rig');
const runsRoot = () => process.env.RIG_RUNS_DIR || path.join(rigHome(), 'runs');
const runDirOf = (runId) => path.join(runsRoot(), V.assertRunId(runId));
const emptyHooksDir = () => path.join(rigHome(), 'empty-hooks');

/** yymmddhhmmss + random: matches the runId validator, sorts by time. */
function newRunId(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const ts = `${String(now.getUTCFullYear()).slice(2)}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
  return `r${ts}-${crypto.randomBytes(3).toString('hex')}`;
}

function writeFileAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
const writeJsonAtomic = (file, obj) => writeFileAtomic(file, `${JSON.stringify(obj)}\n`);

/** Create `file` atomically only if absent (tmp + hard link). @returns {boolean} true when we created it */
function writeFileExclusive(file, data) {
  const tmp = `${file}.${process.pid}.x.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  try { fs.linkSync(tmp, file); return true; } catch (e) { if (e.code === 'EEXIST') return false; throw e; } finally { try { fs.unlinkSync(tmp); } catch { /* gone */ } }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
const mtimeMs = (file) => { try { return fs.statSync(file).mtimeMs; } catch { return null; } };
const exists = (file) => fs.existsSync(file);

/** Touch heartbeat (mtime is the signal; content is informational). */
const touchHeartbeat = (dir) => writeFileAtomic(path.join(dir, 'heartbeat'), `${Date.now()}\n`);

/** Create a fresh 0700 run dir; throws EEXIST when it already exists. */
function createRunDir(runId) {
  fs.mkdirSync(runsRoot(), { recursive: true, mode: 0o700 });
  const dir = runDirOf(runId);
  fs.mkdirSync(dir, { mode: 0o700 });
  return dir;
}

/** Last `lines` lines of a file (reads at most the final 64 KB). */
function tailFile(file, lines = 40) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const len = Math.min(size, 65536);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      return buf.toString('utf8').split(/\r?\n/).slice(-lines - 1).join('\n').trim();
    } finally { fs.closeSync(fd); }
  } catch { return ''; }
}

/**
 * Pure state derivation from files.
 * @returns {{state:'starting'|'running'|'cancelling'|'lost'|'done'|'failed', exit:number|null, failure:string|null, heartbeatAt:number|null, startedAt:number|null}}
 */
function readRunState(dir, now = Date.now()) {
  const run = readJson(path.join(dir, 'run.json'));
  // run.json missing (crash between mkdir and write): fall back to the dir mtime so the run cannot stay `starting` forever
  const startedAt = (run && run.createdAt) || mtimeMs(path.join(dir, 'run.json')) || mtimeMs(dir);
  const heartbeatAt = mtimeMs(path.join(dir, 'heartbeat'));
  const base = { exit: null, failure: null, heartbeatAt, startedAt };
  const exitFile = path.join(dir, 'exit');
  if (exists(exitFile)) {
    const e = readJson(exitFile) || { code: 1, failure: 'prepare' };
    const failed = e.code !== 0 || !!e.failure;
    return { ...base, state: failed ? 'failed' : 'done', exit: e.code, failure: e.failure || null };
  }
  let state;
  if (heartbeatAt === null) {
    if (startedAt === null || now - startedAt >= STARTING_GRACE_MS) return { ...base, state: 'failed', failure: 'not-started' };
    state = 'starting';
  } else {
    state = now - heartbeatAt > HEARTBEAT_STALE_MS ? 'lost' : 'running';
  }
  if (exists(path.join(dir, 'cancelled')) && (state === 'starting' || state === 'running')) state = 'cancelling';
  return { ...base, state };
}

/** One list/status entry (contract with phases 04/05). */
function summarizeRun(dir, now = Date.now()) {
  const run = readJson(path.join(dir, 'run.json')) || {};
  const spec = run.spec || {};
  const result = readJson(path.join(dir, 'result.json')) || {};
  const st = readRunState(dir, now);
  return {
    runId: path.basename(dir), orchestrator: spec.orchestrator || null, slug: spec.slug || null,
    phase: spec.phase || null, kind: spec.kind || null, state: st.state, exit: st.exit,
    failure: st.failure, startedAt: st.startedAt, heartbeatAt: st.heartbeatAt,
    head: result.head || null, pushed: result.pushed === undefined ? null : result.pushed,
  };
}

function listRunDirs() {
  try {
    return fs.readdirSync(runsRoot()).filter((n) => V.isRunId(n)).map((n) => path.join(runsRoot(), n))
      .filter((d) => exists(path.join(d, 'run.json')));
  } catch { return []; }
}

// ---- busy markers: exclusive-create files holding the owning runId ----
const busyFile = (name) => path.join(rigHome(), `${name}.busy`);

/** Holder of marker `name` if it is live ('unknown' for a fresh unparsable marker), else null (absent or stale). */
function liveBusyHolder(name) {
  const file = busyFile(name);
  let holder = '';
  try { holder = fs.readFileSync(file, 'utf8').trim(); } catch { return null; }
  // Unparsable/empty holder (foreign or legacy writer mid-create): live until it ages past the grace period.
  if (!V.isRunId(holder)) return Date.now() - (mtimeMs(file) || 0) < BUSY_HOLDER_GRACE_MS ? 'unknown' : null;
  return ['starting', 'running', 'cancelling'].includes(readRunState(runDirOf(holder)).state) ? holder : null;
}

/** @returns {{ok:true}|{ok:false, holder:string}} */
function acquireBusy(name, runId) {
  fs.mkdirSync(rigHome(), { recursive: true, mode: 0o700 });
  const file = busyFile(name);
  for (let attempt = 0; attempt < 2; attempt++) {
    // Write the holder to a private temp file, then hard-link it into place: link() fails
    // with EEXIST atomically and readers can never observe a created-but-empty marker.
    const tmp = `${file}.${process.pid}.${attempt}.tmp`;
    try {
      fs.writeFileSync(tmp, runId, { mode: 0o600 });
      fs.linkSync(tmp, file);
      return { ok: true };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    } finally { try { fs.unlinkSync(tmp); } catch { /* already gone */ } }
    let holder = '';
    try { holder = fs.readFileSync(file, 'utf8').trim(); } catch { continue; }
    if (holder === runId) return { ok: true };
    const live = liveBusyHolder(name);
    if (live) return { ok: false, holder: live };
    try { fs.unlinkSync(file); } catch { /* raced with another cleaner */ }
  }
  return { ok: false, holder: 'unknown' };
}

function releaseBusy(name, runId) {
  try {
    if (fs.readFileSync(busyFile(name), 'utf8').trim() === runId) fs.unlinkSync(busyFile(name));
  } catch { /* already gone */ }
}

/** Stable short id of a clone (realpath so symlinked paths share one id). Lives here (lowest layer) so busy names and baselines share it. */
function cloneHash(repo) {
  let real = repo;
  try { real = fs.realpathSync(repo); } catch { /* missing repo: hash the given path */ }
  return crypto.createHash('sha256').update(real).digest('hex').slice(0, 16);
}

/** One agent marker and one test marker per clone: `agent-<hash>` / `test-<hash>`. */
const busyNameFor = (kind, repo) => `${kind === 'agent' ? 'agent' : 'test'}-${cloneHash(repo)}`;
const busyNameForRun = (run) => busyNameFor(run.spec.kind, run.target.repo);

/** Release every marker held by `runId` (run.json-less orphans cannot derive their clone). */
function releaseBusyHeldBy(runId) {
  let names = [];
  try { names = fs.readdirSync(rigHome()); } catch { return; }
  for (const n of names.filter((f) => f.endsWith('.busy'))) releaseBusy(n.slice(0, -5), runId);
}

module.exports = {
  FAILURES, STARTING_GRACE_MS, HEARTBEAT_STALE_MS, RunFailure, rigHome, runsRoot, runDirOf, emptyHooksDir,
  newRunId, writeFileAtomic, writeFileExclusive, writeJsonAtomic, readJson, mtimeMs, exists, touchHeartbeat, createRunDir,
  tailFile, readRunState, summarizeRun, listRunDirs, acquireBusy, releaseBusy, releaseBusyHeldBy, liveBusyHolder, busyNameFor, busyNameForRun, cloneHash, busyFile,
};
