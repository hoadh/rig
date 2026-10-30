/**
 * Picks the command that runs the skills dependency installer for a platform.
 * Windows: install.ps1 via PowerShell (install.sh exits 1 on msys/cygwin).
 * Elsewhere: install.sh via bash. `yes` maps to -y (bash) / -Y (PowerShell).
 */
const path = require('path');

function skillsInstallerCommand(platform, skillsDir, yes) {
  if (platform === 'win32') {
    return {
      cmd: 'powershell',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(skillsDir, 'install.ps1'), ...(yes ? ['-Y'] : [])],
    };
  }
  return { cmd: 'bash', args: [path.join(skillsDir, 'install.sh'), ...(yes ? ['-y'] : [])] };
}

module.exports = { skillsInstallerCommand };
