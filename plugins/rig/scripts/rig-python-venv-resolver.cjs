'use strict';
/**
 * `rig-python`: python from the Rig venv, created on first use.
 *
 * Venv location: `$CLAUDE_PLUGIN_DATA/venv` when Claude Code gave us a data dir (hooks only; the Bash tool
 * does not export it), else `~/.claude/rig/venv`. It is built by the skills installer (`skills/install.sh`
 * or `install.ps1`, pointed at the target with RIG_VENV_DIR) so plugin updates never wipe it and nothing is
 * written into the read-only plugin cache. The 1.x venv (the `.venv` inside the 1.x skills dir) is left alone for the migrator.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { kitRootOf, runAndExit } = require('./rig-bin-launcher.cjs');
const { spawnSync } = require('child_process');

const isWindows = (platform) => platform === 'win32';

/** Venv dir for this environment (an unset or relative CLAUDE_PLUGIN_DATA is ignored). */
function venvDirFor({ env = process.env, home = os.homedir() } = {}) {
  const data = env.CLAUDE_PLUGIN_DATA;
  return data && path.isAbsolute(data) ? path.join(data, 'venv') : path.join(home, '.claude', 'rig', 'venv');
}

/** The interpreter inside a venv: bin/python3 on POSIX, Scripts\python.exe on Windows. */
function venvPythonPath(venvDir, platform = process.platform) {
  return isWindows(platform) ? path.join(venvDir, 'Scripts', 'python.exe') : path.join(venvDir, 'bin', 'python3');
}

/** Installer command (argv) for this OS; `skillsDir` holds install.sh / install.ps1. */
function installerCommand(skillsDir, platform = process.platform) {
  return isWindows(platform)
    ? ['powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(skillsDir, 'install.ps1'), '-Y']]
    : ['bash', [path.join(skillsDir, 'install.sh'), '-y']];
}

/**
 * Make sure the venv python exists, building the venv with the skills installer when it does not.
 * The installer's output goes to stderr so python's own stdout stays clean for callers.
 * @returns {string} absolute path of the venv python
 */
function ensureVenvPython({ kitRoot, venvDir, platform = process.platform, env = process.env, spawn = spawnSync }) {
  const python = venvPythonPath(venvDir, platform);
  if (fs.existsSync(python)) return python;
  const skillsDir = path.join(kitRoot, 'skills');
  const [cmd, args] = installerCommand(skillsDir, platform);
  fs.mkdirSync(path.dirname(venvDir), { recursive: true });
  process.stderr.write(`rig-python: no venv at ${venvDir}; creating it with ${path.basename(args.find((a) => /install\.(sh|ps1)$/.test(a)))} (first use only)\n`);
  const res = spawn(cmd, args, { stdio: ['ignore', 2, 2], env: { ...env, RIG_VENV_DIR: venvDir, NON_INTERACTIVE: '1' } });
  if (res.error) throw new Error(`cannot run the skills installer (${cmd}): ${res.error.message}`);
  if (!fs.existsSync(python)) throw new Error(`the skills installer finished (exit ${res.status}) but ${python} does not exist`);
  return python;
}

/** Entry for bin/rig-python and bin/rig-ui-search: run the venv python with `args`, exit with its status. */
function main(binFile, args) {
  let python;
  try {
    python = ensureVenvPython({ kitRoot: kitRootOf(binFile), venvDir: venvDirFor() });
  } catch (err) {
    process.stderr.write(`rig-python: ${err.message}\n`);
    process.exit(1);
  }
  runAndExit(python, args);
}

module.exports = { venvDirFor, venvPythonPath, installerCommand, ensureVenvPython, main };
