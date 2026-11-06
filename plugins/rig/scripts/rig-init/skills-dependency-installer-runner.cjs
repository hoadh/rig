'use strict';
/**
 * `rig-init --deps`: runs the skills' own dependency installer (skills/install.sh, skills/install.ps1 on Windows)
 * for the full set: system packages (ffmpeg, imagemagick), global npm tools, skill npm dependencies and the Python
 * venv. It runs interactively, with no `-y` and no `--with-sudo`, so the installer asks before it installs anything and
 * never uses sudo on its own. The installer writes its npm dependencies next to itself (inside the plugin dir): they
 * are lost with a plugin update, so run `rig-init --deps` again after one. `rig-python` alone builds only the
 * Python venv (at ~/.claude/rig/venv) and needs none of this.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

/** The command that runs the installer for a platform (Windows: install.ps1 via PowerShell; install.sh exits on msys/cygwin). */
function installerCommand(platform, skillsDir) {
  if (platform === 'win32') return { cmd: 'powershell', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(skillsDir, 'install.ps1')] };
  return { cmd: 'bash', args: [path.join(skillsDir, 'install.sh')] };
}

/** @returns {number} the installer's exit status; throws when it cannot be started */
function runSkillsInstaller({ pluginRoot, platform = process.platform, run = spawnSync }) {
  const skillsDir = path.join(pluginRoot, 'skills');
  const { cmd, args } = installerCommand(platform, skillsDir);
  if (!fs.existsSync(args[args.length - 1])) throw new Error(`installer not found: ${args[args.length - 1]}`);
  const res = run(cmd, args, { cwd: skillsDir, stdio: 'inherit' });
  if (res.error) throw new Error(`could not start ${cmd}: ${res.error.message}`);
  return res.status === null ? 1 : res.status;
}

module.exports = { installerCommand, runSkillsInstaller };
