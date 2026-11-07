'use strict';
/**
 * Platform-aware helpers shared by rig:remote tests (DRY: one place for win32 quirks).
 *  - GIT_NULL_CONFIG: os.devNull is `\.\nul` on win32, which native git rejects ("unable to access '//./nul'");
 *    `NUL` works there and os.devNull works elsewhere.
 *  - gitConfigPath: forward-slash a path so it is safe inside a git config value (a raw `C:\Users` makes git
 *    read `\U` as a bad escape).
 *  - hostOs / hostShell: registry `os` / `shell` values matching the machine running the tests.
 *  - isolatedGitEnv: no system/global git config (e.g. system core.autocrlf=true on Git for Windows).
 */
const os = require('os');

const GIT_NULL_CONFIG = process.platform === 'win32' ? 'NUL' : os.devNull;

const gitConfigPath = (p) => String(p).replace(/\\/g, '/');

function hostOs(platform = process.platform) {
  if (platform === 'win32') return 'windows';
  return platform === 'darwin' ? 'macos' : 'linux';
}

function hostShell(platform = process.platform) {
  return platform === 'win32' ? 'powershell' : 'bash';
}

/** Env that makes git ignore system + global config. Extra keys in `extra` win. */
function isolatedGitEnv(base = process.env, extra = {}) {
  return { ...base, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: GIT_NULL_CONFIG, GIT_CONFIG_SYSTEM: GIT_NULL_CONFIG, ...extra };
}

/** Prepends `dir` to PATH in `env` (mutates; honours the existing key's case: win32 uses `Path`). */
function prependPath(env, dir) {
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  env[key] = env[key] ? `${dir}${require('path').delimiter}${env[key]}` : dir;
  return env;
}

/**
 * win32 only: writes a fake `schtasks.exe` into `dir` (see fixtures/fake-schtasks-scheduler.cjs) and puts it first on PATH of
 * `env`. Returns the exe path, or null on other platforms (tmux / node-detached are real there).
 */
function installFakeScheduledTasks(dir, env = process.env) {
  if (process.platform !== 'win32') return null;
  const p = require('path');
  require('fs').mkdirSync(dir, { recursive: true });
  const exe = require('./fake-executable-for-tests.cjs').makeFakeExecutable(
    dir, 'schtasks', `require(${JSON.stringify(p.join(__dirname, 'fixtures', 'fake-schtasks-scheduler.cjs'))});`, { killTree: false });
  prependPath(env, dir);
  return exe;
}

/**
 * Live processes whose command line contains `needle`, as [{pid, command}] (this process and the lister excluded).
 * POSIX: `ps -axo pid=,command=`; win32: PowerShell Win32_Process (Git Bash `ps` has no -x).
 */
function processesMatching(needle) {
  const cp = require('child_process');
  let rows;
  if (process.platform === 'win32') {
    const out = cp.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }'], { encoding: 'utf8', windowsHide: true });
    rows = out.split(/\r?\n/).map((l) => l.split('\t')).filter((p) => p.length >= 2).map(([pid, ...c]) => ({ pid: Number(pid), command: c.join('\t') }));
  } else {
    rows = cp.execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n').filter(Boolean)
      .map((l) => { const m = /^\s*(\d+)\s+(.*)$/.exec(l); return { pid: Number(m[1]), command: m[2] }; });
  }
  return rows.filter((r) => r.command.includes(needle) && r.pid !== process.pid && !/Get-CimInstance Win32_Process|ps -axo/.test(r.command));
}

/** Shell command (for the host's registry shell) that exits 0 only if every relative file path exists. */
function filesExistCommand(...paths) {
  if (process.platform !== 'win32') return paths.map((p) => `test -f ${p}`).join(' && ');
  const tests = paths.map((p) => `(Test-Path -PathType Leaf '${p}')`).join(' -and ');
  return `if (-not (${tests})) { exit 1 }`;
}

/**
 * rm -rf that retries on win32, where a just-exited detached runner can still pin its cwd (EPERM/EBUSY/ENOTEMPTY) for
 * a moment. fs.rmSync's own maxRetries does not cover this reliably. Throws the last error after ~10 s.
 */
function removeDirRetrying(dir) {
  for (let i = 0; ; i++) {
    try { require('fs').rmSync(dir, { recursive: true, force: true }); return; } catch (e) {
      if (i >= 40 || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
}

module.exports = { removeDirRetrying, filesExistCommand, GIT_NULL_CONFIG, gitConfigPath, hostOs, hostShell, isolatedGitEnv, prependPath, installFakeScheduledTasks, processesMatching };
