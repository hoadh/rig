const assert = require('assert');
const path = require('path');
const { skillsInstallerCommand } = require('./skills-installer-command.cjs');

const dir = path.join('x', 'skills');

let c = skillsInstallerCommand('win32', dir, true);
assert.strictEqual(c.cmd, 'powershell');
assert.deepStrictEqual(c.args, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(dir, 'install.ps1'), '-Y']);

c = skillsInstallerCommand('win32', dir, false);
assert.ok(!c.args.includes('-Y'));

c = skillsInstallerCommand('linux', dir, true);
assert.deepStrictEqual(c, { cmd: 'bash', args: [path.join(dir, 'install.sh'), '-y'] });

c = skillsInstallerCommand('darwin', dir, false);
assert.deepStrictEqual(c, { cmd: 'bash', args: [path.join(dir, 'install.sh')] });

console.log('skills-installer-command: all passed');
