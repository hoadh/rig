'use strict';
/**
 * Test helper: temp dir holding a bare "origin" plus N clones with a local
 * git identity (never touches global config). Shared by phases 03-06.
 *   const env = makeRepoWithBareRemote({clones: ['a','b']});
 *   env.origin, env.clone('a'), env.git(dir, ...args), env.cleanup()
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isolatedGitEnv, gitConfigPath, removeDirRetrying } = require('./platform-test-fixtures.cjs');

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: isolatedGitEnv(),
  }).trim();
}

function makeRepoWithBareRemote({ clones = ['main'], files = { 'README.md': '# test\n' } } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rig-remote-test-')));
  // forward slashes on win32: test-clone-config-resetter writes the origin url raw into .git/config and git
  // reads a backslash escape (like "\U" in C:\Users) as a bad config line. See report: product bug.
  const origin = gitConfigPath(path.join(root, 'origin.git'));
  execFileSync('git', ['init', '--bare', '-q', '--initial-branch=main', origin]);
  const dirs = {};
  const identify = (dir) => {
    git(dir, 'config', 'user.name', 'Rig Test');
    git(dir, 'config', 'user.email', 'rig-test@example.invalid');
    git(dir, 'config', 'commit.gpgsign', 'false');
  };
  clones.forEach((name, i) => {
    const dir = path.join(root, name);
    execFileSync('git', ['clone', '-q', origin, dir], { stdio: 'ignore' });
    identify(dir);
    if (i === 0) { // seed first commit on main
      git(dir, 'checkout', '-q', '-B', 'main');
      for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), c);
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'init');
      git(dir, 'push', '-q', '-u', 'origin', 'main');
    } else {
      git(dir, 'checkout', '-q', '-B', 'main', 'origin/main');
    }
    dirs[name] = dir;
  });
  return {
    root, origin, git,
    clone: (name) => dirs[name],
    commitFile(name, file, content, msg = `edit ${file}`) {
      fs.mkdirSync(path.dirname(path.join(dirs[name], file)), { recursive: true });
      fs.writeFileSync(path.join(dirs[name], file), content);
      git(dirs[name], 'add', '-A');
      git(dirs[name], 'commit', '-q', '-m', msg);
      return git(dirs[name], 'rev-parse', 'HEAD');
    },
    cleanup: () => removeDirRetrying(root), // win32: late handle release
  };
}

module.exports = { makeRepoWithBareRemote, git };
