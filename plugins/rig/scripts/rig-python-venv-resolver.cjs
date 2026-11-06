'use strict';
/**
 * `rig-python`: python from the Rig venv, created on first use.
 *
 * Which venv (ONE function for the bins and the session context, `venvDirFor`):
 *   - plugin install (`<root>/.claude-plugin/plugin.json`): `~/.claude/rig/venv`. CLAUDE_PLUGIN_DATA is deliberately
 *     not consulted: hooks get it but the Bash tool does not (spike 2026-11-06), so honoring it would make the
 *     session context and the bins name different venvs.
 *   - file install (the kit root is an installed `.claude` dir): `<root>/skills/.venv`, the venv the 1.x installer builds.
 *
 * What it builds: a venv and `pip install -r` of the skills' Python requirements. Nothing else: no system packages,
 * no npm, no sudo (the full dependency install is rig-init / the skills installer, run explicitly).
 *
 * How: into `<venv>.tmp-<pid>` under a lock, `.rig-ready` (holding the requirements hash) written last, then renamed
 * into place. A plugin venv counts as ready only with a matching `.rig-ready`; a different or missing marker rebuilds it.
 * A venv at a file install's path without a marker comes from the 1.x installer and is used as it is.
 */
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { kitRootOf, runAndExit } = require('./rig-bin-launcher.cjs');
const { acquireLock, releaseLock, sleepSync } = require('../hooks/lib/dir-lock-with-owner-token.cjs');

const READY_MARKER = '.rig-ready';
const LOCK_STALE_MS = 30 * 60 * 1000; // a first build can take minutes
const WAIT_MS = 20 * 60 * 1000;
const POLL_MS = 2000;
const isWindows = (platform) => platform === 'win32';

const isPluginRoot = (kitRoot) => fs.existsSync(path.join(kitRoot, '.claude-plugin', 'plugin.json'));

/** The venv for a kit root. Pure path logic, no I/O beyond the plugin manifest check. */
function venvDirFor({ kitRoot, home = os.homedir() }) {
  return isPluginRoot(kitRoot) ? path.join(home, '.claude', 'rig', 'venv') : path.join(kitRoot, 'skills', '.venv');
}

/** The interpreter inside a venv: bin/python3 on POSIX, Scripts\python.exe on Windows. */
function venvPythonPath(venvDir, platform = process.platform) {
  return isWindows(platform) ? path.join(venvDir, 'Scripts', 'python.exe') : path.join(venvDir, 'bin', 'python3');
}

/** Requirement files whose packages the venv carries: scripts/ and every skill's scripts/requirements.txt. */
function requirementFiles(kitRoot) {
  const files = [path.join(kitRoot, 'scripts', 'requirements.txt')];
  const skills = path.join(kitRoot, 'skills');
  if (fs.existsSync(skills)) {
    for (const name of fs.readdirSync(skills).sort()) files.push(path.join(skills, name, 'scripts', 'requirements.txt'));
  }
  return files.filter((f) => fs.existsSync(f));
}

/** sha256 over the requirement files (relative path + normalized bytes): a changed requirement rebuilds the venv. */
function requirementsHash(kitRoot) {
  const h = crypto.createHash('sha256');
  for (const f of requirementFiles(kitRoot)) {
    h.update(`${path.relative(kitRoot, f).split(path.sep).join('/')}\0`);
    h.update(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'));
    h.update('\0');
  }
  return h.digest('hex');
}

const readMarker = (venvDir) => {
  try { return fs.readFileSync(path.join(venvDir, READY_MARKER), 'utf8').trim(); } catch { return null; }
};

/**
 * Is the venv usable as it is? Plugin venv: python exists AND the marker matches the requirements hash.
 * File install venv: python exists, and when it carries our marker the hash must match too.
 */
function venvReady({ kitRoot, venvDir, platform = process.platform }) {
  if (!fs.existsSync(venvPythonPath(venvDir, platform))) return false;
  const marker = readMarker(venvDir);
  if (marker === null) return !isPluginRoot(kitRoot);
  return marker === requirementsHash(kitRoot);
}

/** A system python to build with: `python3`, `python`, or `py -3`; the first that answers `--version`. */
function findSystemPython({ platform = process.platform, spawn = spawnSync } = {}) {
  const candidates = isWindows(platform) ? [['python', []], ['py', ['-3']], ['python3', []]] : [['python3', []], ['python', []]];
  for (const [cmd, pre] of candidates) {
    const res = spawn(cmd, [...pre, '--version'], { stdio: 'ignore' });
    if (!res.error && res.status === 0) return { cmd, pre };
  }
  return null;
}

/** Run a build step with its output on stderr (stdout stays clean for the python the caller runs next). */
function runStep(spawn, cmd, args, label) {
  const res = spawn(cmd, args, { stdio: ['ignore', 2, 2] });
  if (res.error) throw new Error(`${label}: cannot run ${cmd}: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`${label} failed (exit ${res.status})`);
}

/** Build the venv into a temp sibling dir, mark it ready, then rename it into place. Caller holds the lock. */
function buildVenv({ kitRoot, venvDir, platform, spawn, systemPython }) {
  const tmp = `${venvDir}.tmp-${process.pid}`;
  const old = `${venvDir}.old-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  try {
    runStep(spawn, systemPython.cmd, [...systemPython.pre, '-m', 'venv', tmp], 'creating the venv');
    const python = venvPythonPath(tmp, platform);
    for (const file of requirementFiles(kitRoot)) {
      runStep(spawn, python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--prefer-binary', '-r', file], `pip install -r ${path.relative(kitRoot, file)}`);
    }
    fs.writeFileSync(path.join(tmp, READY_MARKER), `${requirementsHash(kitRoot)}\n`); // last
    fs.rmSync(old, { recursive: true, force: true });
    if (fs.existsSync(venvDir)) fs.renameSync(venvDir, old);
    fs.renameSync(tmp, venvDir);
    fs.rmSync(old, { recursive: true, force: true });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Make sure the venv is ready, building it when it is not (one builder at a time; others wait for it).
 * @returns {string} absolute path of the venv python
 */
function ensureVenvPython({ kitRoot, venvDir, platform = process.platform, spawn = spawnSync, waitMs = WAIT_MS, pollMs = POLL_MS }) {
  const python = venvPythonPath(venvDir, platform);
  const ready = () => venvReady({ kitRoot, venvDir, platform });
  if (ready()) return python;
  const systemPython = findSystemPython({ platform, spawn });
  if (!systemPython) throw new Error('no python3 found on PATH; install Python 3 (or run rig-init) and retry');
  fs.mkdirSync(path.dirname(venvDir), { recursive: true });
  const lockDir = `${venvDir}.lock`;
  const deadline = Date.now() + waitMs;
  for (;;) {
    const token = acquireLock(lockDir, LOCK_STALE_MS);
    if (token) {
      try {
        if (ready()) return python; // another process finished while we waited for the lock
        process.stderr.write(`rig-python: creating Rig Python venv at ${venvDir}, one-time (venv + pip install of the skills' requirements only)\n`);
        buildVenv({ kitRoot, venvDir, platform, spawn, systemPython });
      } finally {
        releaseLock(lockDir, token);
      }
      if (!ready()) throw new Error(`the venv build finished but ${python} is not ready`);
      return python;
    }
    if (ready()) return python;
    if (Date.now() > deadline) throw new Error(`another process has been building ${venvDir} for ${Math.round(waitMs / 60000)} min; retry later or remove ${lockDir} if it is stale`);
    process.stderr.write(`rig-python: waiting for another process to finish building ${venvDir}\n`);
    sleepSync(pollMs);
  }
}

/**
 * Entry for bin/rig-python, rig-ui-search, rig-resolve-env: run the venv python with `args`, exit with its status.
 * `stdlibOnly` scripts (no third-party imports) use the system python while the venv does not exist yet,
 * instead of triggering the first build.
 */
function main(binFile, args, { stdlibOnly = false } = {}) {
  let python;
  try {
    const kitRoot = kitRootOf(binFile);
    const venvDir = venvDirFor({ kitRoot });
    const ready = venvReady({ kitRoot, venvDir });
    const system = stdlibOnly && !ready ? findSystemPython() : null;
    if (system) runAndExit(system.cmd, [...system.pre, ...args]);
    python = ensureVenvPython({ kitRoot, venvDir });
  } catch (err) {
    process.stderr.write(`rig-python: ${err.message}\n`);
    process.exit(1);
  }
  runAndExit(python, args);
}

module.exports = { venvDirFor, venvPythonPath, venvReady, requirementFiles, requirementsHash, findSystemPython, ensureVenvPython, buildVenv, main, READY_MARKER };
