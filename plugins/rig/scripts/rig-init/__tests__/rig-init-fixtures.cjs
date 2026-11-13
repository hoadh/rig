'use strict';
/** Fixture builders for the rig-init tests: a throwaway HOME with a settings.json. Never touches the real ~/.claude. */
const fs = require('fs');
const os = require('os');
const path = require('path');

const USER_HOOK_COMMAND = 'node /opt/my-tools/own-hook.js';
// The statusLine a Rig 1.x global install wrote: `rig-init --runtime` may replace it
const RIG_1X_STATUSLINE = 'node "$HOME/.claude/statusline.cjs"';

function tmpDir(prefix = 'rig-init-') {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/**
 * A fixture HOME. With `settings` (default) it holds ~/.claude/settings.json with a user hook, a few permission rules
 * and the 1.x Rig statusLine.
 */
function makeMachine({ settings = true } = {}) {
  const root = tmpDir();
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });
  if (settings) {
    write(path.join(home, '.claude', 'settings.json'), `${JSON.stringify({
      theme: 'dark',
      statusLine: { type: 'command', command: RIG_1X_STATUSLINE, padding: 0 },
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: USER_HOOK_COMMAND }] }] },
      permissions: { ask: ['Read(**/.env)'], allow: ['Bash(ls)'] },
    }, null, 2)}\n`);
  }
  return { root, home, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

/** Sorted list of every path below `dir` (files, dirs, symlinks) with file contents: the "state" tests compare. */
function snapshot(dir) {
  const out = {};
  const walk = (abs, rel) => {
    for (const name of fs.readdirSync(abs).sort()) {
      const full = path.join(abs, name);
      const r = rel ? `${rel}/${name}` : name;
      // Windows PowerShell (the consent gate's ancestry query) creates AppData\Roaming under a fixture USERPROFILE: its
      // profile bootstrap, not a rig-init write, so it is not state
      if (process.platform === 'win32' && rel === 'home' && name === 'AppData') continue;
      const st = fs.lstatSync(full);
      if (st.isDirectory()) { out[`${r}/`] = 'dir'; walk(full, r); } else out[r] = st.isSymbolicLink() ? `-> ${fs.readlinkSync(full)}` : fs.readFileSync(full, 'utf8');
    }
  };
  walk(dir, '');
  return out;
}

module.exports = { tmpDir, write, makeMachine, snapshot, USER_HOOK_COMMAND, RIG_1X_STATUSLINE };
