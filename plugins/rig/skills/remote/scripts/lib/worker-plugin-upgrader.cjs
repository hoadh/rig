'use strict';
/**
 * Orchestrator side of `rig-remote upgrade`: brings ONE registry machine to the orchestrator's Rig version.
 *
 * Steps (each returns {ok, ...}; the first failure stops that machine, the caller goes on with the next):
 *   1 preflight   `claude --version` >= CLAUDE_FLOOR, `claude plugin list --json` has rig@rig-marketplace
 *   2 busy        worker `list` shows no starting/running/cancelling run (refuse, or poll with `wait`)
 *   3 update      `claude plugin marketplace update rig-marketplace`, `claude plugin update rig@rig-marketplace --json`
 *   4 refresh     `node <installPath>/scripts/refresh-runtime-copy.cjs --json` (plugin/scripts, phase 1)
 *   5 verify      fresh `info` handshake: version and scripts hash against the orchestrator
 * `check` stops after the read-only part (1, 2 and the version comparison): no plugin, runtime or settings change
 * (the worker's `list` does its usual run-directory housekeeping). Preflight also dry-runs the step 4 command line.
 * Known limit: two concurrent `upgrade` runs against one worker are not serialized (the runtime copy itself is locked).
 *
 * Why plain `claude`/`node` over ssh and not worker.cjs: the worker script is the runtime copy this command
 * replaces, and a worker with no runtime or another major cannot run it. One command per ssh call, quoted for the
 * machine's shell the way remote-command-builder does; arguments are fixed tokens or the validated installPath,
 * never user input. Every I/O seam is in `io`, so unit tests never touch the network.
 *
 * `claude plugin list --json` (read on Claude Code 2.1.323): a bare array of {id, version, scope, enabled,
 * installPath, installedAt, lastUpdated, projectEnabled}; with `--available` an object {installed: [...],
 * available: [{pluginId, name, marketplaceName, version?, source}]}. Both shapes are accepted and every field is
 * optional here. The `--json` result line of `claude plugin update` could not be observed without updating
 * (the help text names `shownCommand.sha256`), so only that, `success === false` and an `error` string are read;
 * the exit code is the main signal and the follow-up `list` is the source of truth for installPath/version.
 */
const os = require('os');
const { RemoteError, EXIT, usageError } = require('./remote-errors.cjs');
const V = require('./identifier-validators.cjs');
const { quoteExecutable } = require('./remote-command-builder.cjs');
const { buildSshArgv, execWorker, resetHandshake, isLocalTransport } = require('./ssh-transport.cjs');
const { getMachine } = require('./machine-registry.cjs');
const { runChild } = require('./capped-child-process-runner.cjs');
const { redactText } = require('./secret-redaction.cjs');
const { WORKER_INSTALL_HINT, compareVersions, SEMVER } = require('./rig-version-compat.cjs');

const PLUGIN_ID = 'rig@rig-marketplace';
const MARKETPLACE = 'rig-marketplace';
const CLAUDE_FLOOR = '2.1.292';
const STEP_TIMEOUT_MS = 120_000;
const UPDATE_TIMEOUT_MS = 300_000;
const BUSY_POLL_MS = 5_000;
const BUSY_WAIT_MAX_MS = 30 * 60 * 1000;
const ACTIVE_STATES = new Set(['starting', 'running', 'cancelling']);
// `list` failures that only mean "this worker cannot run anything yet" (no runtime, other major, broken copy); any other failure (timeout, unreachable, bad output) could hide an active run
const IDLE_ERROR_CLASSES = new Set(['worker-missing', 'command-not-found', 'protocol-mismatch', 'version-mismatch', 'version-unknown', 'runtime-incomplete', 'worker-error']);
// letters/digits of any script (non-ASCII home dirs) and `~` (Windows 8.3 names) are as safe as ASCII ones here
const ARG_RE = /^[\p{L}\p{N}_@.:=\\/ ~-]+$/u;
const INSTALL_HINT = `${WORKER_INSTALL_HINT}; run \`claude plugin install ${PLUGIN_ID}\` there first (1.x installs are not supported)`;

/**
 * The single ssh command string for `exe args...` under the machine's shell. Executable via quoteExecutable;
 * each argument is a conservative token (spaces get the shell's quotes). A cmd line is sent as is: Windows OpenSSH
 * keeps a leading quoted executable intact, and an extra outer pair breaks it (checked live on Windows 11).
 */
function buildRemoteCommand(cfg, exe, args = []) {
  const parts = [quoteExecutable(exe, cfg.shell)];
  for (const a of args) {
    if (typeof a !== 'string' || !ARG_RE.test(a)) throw usageError(`cannot pass ${JSON.stringify(a)} through ssh safely`);
    if (!a.includes(' ')) parts.push(a);
    else parts.push(cfg.shell === 'bash' ? `'${a}'` : `"${a}"`);
  }
  return parts.join(' ');
}

/** Default I/O: real ssh (or a direct spawn on the local transport), the worker `list`/`info` commands. */
function defaultIo() {
  return {
    /** @returns {Promise<{code:number|null, stdout:string, stderr:string}>} rejects with RemoteError on transport failure */
    async sh(name, cfg, exe, args, timeoutMs = STEP_TIMEOUT_MS) {
      if (isLocalTransport(name)) return runChild(exe, args, { cwd: os.homedir(), timeoutMs });
      const res = await runChild('ssh', buildSshArgv(cfg.ssh, buildRemoteCommand(cfg, exe, args)), { cwd: os.homedir(), timeoutMs });
      if (res.code === 255) throw new RemoteError(`${name}: ssh could not reach the machine`, EXIT.TRANSPORT, { class: 'unreachable', hint: clip(res.stderr) });
      return res;
    },
    workerList: async (name) => (await execWorker(name, 'list', [], { machineConfig: getMachine(name) })).reply,
    workerInfo: async (name) => (await execWorker(name, 'info', [], { machineConfig: getMachine(name) })).reply,
    resetHandshake,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

const clip = (s, n = 300) => redactText(String(s || '').trim()).text.split(/\r?\n/).filter(Boolean).slice(-4).join(' | ').slice(-n);
const fail = (step, detail, fix) => ({ ok: false, step, detail, fix });
/** Worker-reported text is data: only a well-formed version is ever printed, else null. */
const safeVersion = (v) => (typeof v === 'string' && SEMVER.test(v) ? v : null);

/** The refresh script path inside a plugin install dir, in the machine OS's separator. */
function refreshScriptPath(cfg, installPath) {
  const sep = cfg.os === 'windows' ? '\\' : '/';
  return `${installPath.replace(/[\\/]+$/, '')}${sep}scripts${sep}refresh-runtime-copy.cjs`;
}

/**
 * Dry-run of the refresh step: the installPath must be an absolute path and the whole command line must be
 * buildable for the machine's shell. Run before the first write so a path ssh cannot carry never half-upgrades a worker.
 * @returns {{ok:true, script:string}|{ok:false,...}}
 */
function checkRefreshCommand(cfg, installPath, name) {
  if (typeof installPath !== 'string' || !installPath) {
    return fail('refresh', `${PLUGIN_ID} has no installPath in \`claude plugin list --json\``, 'run `claude plugin list --json` on the worker; reinstall the plugin if the entry is broken');
  }
  try {
    V.assertAbsPath(installPath, cfg.os, 'installPath', { allowSpaces: true });
    const script = refreshScriptPath(cfg, installPath);
    buildRemoteCommand(cfg, cfg.node || 'node', [script, '--json']);
    return { ok: true, script };
  } catch (e) {
    return fail('refresh', `the plugin install path on ${name} cannot be passed through ssh: ${clip(e.message)}`,
      'use a plugin install path without shell-special characters (home directory with only letters, digits, spaces, . _ - ~), or update this worker by hand: docs/how-to/run-plan-across-machines.md');
  }
}

/** installed/available entries of either `claude plugin list --json` shape. */
function parsePluginList(stdout) {
  let data;
  try { data = JSON.parse(String(stdout).trim()); } catch { return null; }
  const installed = Array.isArray(data) ? data : data && Array.isArray(data.installed) ? data.installed : null;
  return installed && { installed, available: data && !Array.isArray(data) && Array.isArray(data.available) ? data.available : [] };
}

/** The user-scope (else first) rig entry with a usable version/installPath. */
function findRigEntry(list) {
  const mine = list.installed.filter((p) => p && p.id === PLUGIN_ID);
  return mine.find((p) => p.scope === 'user') || mine[0] || null;
}

async function listPlugins(io, name, cfg, extra = []) {
  const claude = cfg.claude || 'claude';
  const r = await io.sh(name, cfg, claude, ['plugin', 'list', '--json', ...extra]);
  if (r.code !== 0) return { error: fail('preflight', `claude plugin list failed (exit ${r.code}): ${clip(r.stderr)}`, 'update Claude Code on the worker, or set the absolute "claude" path in the registry') };
  const list = parsePluginList(r.stdout);
  if (!list) return { error: fail('preflight', 'claude plugin list --json did not return JSON', `Claude Code on the worker must be >= ${CLAUDE_FLOOR}`) };
  return { list };
}

/** Step 1. @returns {{ok:true, entry, list}|{ok:false,...}|{skip:true,...}} */
async function preflight(io, name, cfg) {
  const claude = cfg.claude || 'claude';
  const v = await io.sh(name, cfg, claude, ['--version']);
  if (v.code !== 0) return fail('preflight', `claude --version failed (exit ${v.code}): ${clip(v.stderr)}`, 'set the absolute "claude" path in the registry');
  const ver = /(\d+\.\d+\.\d+)/.exec(v.stdout);
  if (!ver || compareVersions(ver[1], CLAUDE_FLOOR) < 0) {
    return fail('preflight', `Claude Code ${ver ? ver[1] : 'version unknown'} is older than ${CLAUDE_FLOOR}`, 'update Claude Code on the worker');
  }
  const { list, error } = await listPlugins(io, name, cfg, ['--available']);
  if (error) {
    // an older CLI may reject --available: retry plain
    const plain = await listPlugins(io, name, cfg);
    if (plain.error) return plain.error;
    return rigOrSkip(plain.list, ver[1], name, cfg);
  }
  return rigOrSkip(list, ver[1], name, cfg);
}

function rigOrSkip(list, claudeVersion, name, cfg) {
  const entry = findRigEntry(list);
  if (!entry) return { skip: true, step: 'preflight', detail: `${PLUGIN_ID} is not installed on the worker`, fix: INSTALL_HINT };
  const refresh = checkRefreshCommand(cfg, entry.installPath, name);
  if (!refresh.ok) return refresh;
  return { ok: true, entry, list, claudeVersion };
}

/**
 * Step 2. Resolves {ok:true} or a failure; with `wait` polls until idle (max BUSY_WAIT_MAX_MS). A worker with no usable
 * runtime (IDLE_ERROR_CLASSES) is idle; a list that timed out or could not reach the machine fails the machine.
 */
async function busyCheck(io, name, { wait }) {
  const deadline = Date.now() + BUSY_WAIT_MAX_MS;
  for (;;) {
    let runs = [];
    try {
      const reply = await io.workerList(name);
      if (reply && Array.isArray(reply.runs)) runs = reply.runs;
    } catch (e) {
      if (!(e instanceof RemoteError && IDLE_ERROR_CLASSES.has(e.class))) {
        return fail('busy', `cannot list the active runs: ${clip(e.message)}`, `an active run could be hurt by the update: check ssh and \`rig-remote doctor ${name}\`, then retry`);
      }
    }
    const active = runs.filter((r) => r && ACTIVE_STATES.has(r.state));
    if (!active.length) return { ok: true };
    const what = active.map((r) => `${V.isRunId(r.runId) ? r.runId : '(invalid id)'}${V.isSlug(r.slug) ? ` (${r.slug})` : ''}`).join(', ');
    if (!wait || Date.now() >= deadline) {
      return fail('busy', `${active.length} active run(s): ${what}`, wait ? 'runs did not finish within 30 minutes' : 'wait for the run to finish, cancel it, or pass --wait');
    }
    await io.sleep(BUSY_POLL_MS);
  }
}

/** Step 3. */
async function updatePlugin(io, name, cfg) {
  const claude = cfg.claude || 'claude';
  const m = await io.sh(name, cfg, claude, ['plugin', 'marketplace', 'update', MARKETPLACE], UPDATE_TIMEOUT_MS);
  if (m.code !== 0) return fail('update', `marketplace update failed (exit ${m.code}): ${clip(m.stderr || m.stdout)}`, 'the worker needs network access to GitHub; nothing was changed');
  const u = await io.sh(name, cfg, claude, ['plugin', 'update', PLUGIN_ID, '--json'], UPDATE_TIMEOUT_MS);
  let res = null;
  const lastLine = String(u.stdout).trim().split(/\r?\n/).pop();
  try { res = JSON.parse(lastLine); } catch { /* human text or empty: judged by the exit code */ }
  if (res && res.shownCommand) {
    const cmd = typeof res.shownCommand === 'object' ? res.shownCommand.command || JSON.stringify(res.shownCommand) : String(res.shownCommand);
    return fail('update', `claude wants a person to confirm a marketplace-declared command: ${clip(cmd)}`, `run \`claude plugin update ${PLUGIN_ID}\` on ${name} yourself`);
  }
  if (u.code !== 0 || (res && (res.success === false || typeof res.error === 'string'))) {
    return fail('update', `plugin update failed (exit ${u.code}): ${clip((res && res.error) || u.stderr || u.stdout)}`, `run \`claude plugin update ${PLUGIN_ID}\` on ${name} and read its message`);
  }
  return { ok: true };
}

/** Step 4. @returns {{ok:true, refresh:object, version:string|null}|failure} */
async function refreshRuntime(io, name, cfg) {
  const { list, error } = await listPlugins(io, name, cfg);
  if (error) return fail('refresh', error.detail, error.fix);
  const entry = findRigEntry(list);
  if (!entry) return fail('refresh', `${PLUGIN_ID} is no longer listed after the update`, 'run `claude plugin list --json` on the worker');
  const checked = checkRefreshCommand(cfg, entry.installPath, name);
  if (!checked.ok) return checked;
  const { script } = checked;
  const r = await io.sh(name, cfg, cfg.node || 'node', [script, '--json']);
  let refresh = null;
  try { refresh = JSON.parse(String(r.stdout).trim().split(/\r?\n/).pop()); } catch { /* reported below */ }
  const version = safeVersion(entry.version);
  if (r.code === 0 || (r.code === 3 && refresh && refresh.status === 'newer-present')) return { ok: true, refresh, version };
  const missing = /Cannot find module/i.test(r.stderr);
  return fail('refresh', `runtime refresh failed (exit ${r.code}): ${clip(r.stderr || r.stdout)}`,
    missing ? `the version the marketplace pins (${version || 'unknown'}) has no refresh script (Rig < 2.1): update by hand, see docs/how-to/run-plan-across-machines.md` : `run \`node ${script} --json\` on ${name}`);
}

/** Outcome table for worker vs orchestrator after the refresh. */
function judgeVersions(info, orch) {
  const wv = safeVersion(info.rigVersion);
  if (!wv) return { ok: false, detail: `worker reported no valid Rig version, orchestrator ${orch.version}: cannot compare` };
  const order = compareVersions(wv, orch.version);
  if (order === null) return { ok: false, detail: `worker reports Rig ${wv}, orchestrator ${orch.version}: cannot compare` };
  if (order > 0) return { ok: true, note: `worker is newer than this machine (${wv} vs ${orch.version}): run \`claude plugin update ${PLUGIN_ID}\` here too` };
  if (order < 0) return { ok: false, detail: `worker still runs ${wv}, orchestrator ${orch.version}` };
  if (info.integrityHash !== orch.hash) return { ok: false, detail: `same version ${wv} but scripts differ (half-updated runtime)` };
  return { ok: true, note: 'scripts identical' };
}

/**
 * Upgrade (or with `check`, only inspect) one machine.
 * @param {string} name
 * @param {object} cfg registry entry
 * @param {{orch:{version:string, hash:string}, check?:boolean, wait?:boolean, io?:object}} opts
 * @returns {Promise<{machine:string, status:'ok'|'failed'|'skipped'|'would-upgrade'|'current', from:string|null, to:string|null, step?:string, detail?:string, fix?:string, note?:string}>}
 */
async function upgradeMachine(name, cfg, { orch, check = false, wait = false, io = defaultIo() }) {
  const out = (status, extra = {}) => ({ machine: name, status, from: null, to: null, ...extra });
  const failed = (f, from) => out('failed', { from, step: f.step, detail: f.detail, fix: f.fix });
  let from = null;
  try {
    const pre = await preflight(io, name, cfg);
    if (pre.skip) return out('skipped', { step: pre.step, detail: pre.detail, fix: pre.fix });
    if (!pre.ok) return failed(pre, null);
    from = safeVersion(pre.entry.version);

    const busy = await busyCheck(io, name, { wait });
    if (!busy.ok) return failed(busy, from);

    if (check) {
      const avail = pre.list.available.find((p) => p && p.pluginId === PLUGIN_ID);
      const pinned = avail ? safeVersion(avail.version) : null;
      let runtime = null;
      try { runtime = safeVersion((await io.workerInfo(name)).rigVersion); } catch { /* no runtime yet */ }
      // `--available` leaves out installed plugins (Claude Code 2.1.325), so the pin is usually unknown: print it only when listed
      const note = `plugin ${from || 'unknown'}, runtime ${runtime || 'none'}${pinned ? `, pinned ${pinned}` : ''}, orchestrator ${orch.version}`;
      const versions = [from, runtime].filter(Boolean);
      const newer = versions.some((v) => compareVersions(v, orch.version) > 0);
      const older = versions.length < 2 || versions.some((v) => compareVersions(v, orch.version) < 0);
      if (newer && !older) return out('current', { from, to: from, note: `${note}; worker is newer than this machine: run \`claude plugin update ${PLUGIN_ID}\` here too` });
      return out(!older ? 'current' : 'would-upgrade', { from, to: pinned || orch.version, note });
    }

    const upd = await updatePlugin(io, name, cfg);
    if (!upd.ok) return failed(upd, from);
    const ref = await refreshRuntime(io, name, cfg);
    if (!ref.ok) return failed(ref, from);

    io.resetHandshake(name);
    let info;
    try {
      info = await io.workerInfo(name);
    } catch (e) {
      return failed(fail('verify', `handshake after the refresh failed: ${clip(e.message)}`, `run \`rig-remote doctor ${name}\``), from);
    }
    if (!info || info.error || !safeVersion(info.rigVersion)) {
      return failed(fail('verify', `worker replied without a version: ${clip(info && info.error && info.error.message)}`, `run \`rig-remote doctor ${name}\``), from);
    }
    const verdict = judgeVersions(info, orch);
    if (!verdict.ok) return failed(fail('verify', verdict.detail, `run \`rig-remote doctor ${name}\``), from);
    return out('ok', { from, to: safeVersion(info.rigVersion), note: verdict.note });
  } catch (e) {
    const known = e instanceof RemoteError;
    const detail = clip(e.message);
    const fix = known && e.hint ? clip(e.hint, 400) : known ? `check ssh access: ssh ${cfg.ssh}` : `unexpected error; run \`rig-remote doctor ${name}\``;
    return failed(fail(known && e.class === 'unreachable' ? 'reach' : 'error', detail, fix), from);
  }
}

module.exports = {
  upgradeMachine, buildRemoteCommand, compareVersions, safeVersion, checkRefreshCommand, judgeVersions, parsePluginList, findRigEntry, defaultIo,
  PLUGIN_ID, MARKETPLACE, CLAUDE_FLOOR,
};
