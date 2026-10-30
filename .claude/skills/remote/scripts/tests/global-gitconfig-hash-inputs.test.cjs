'use strict';
/** M2/M3: deterministic global config file set + include/includeIf targets feed the baseline hash. */
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const { makeRepoWithBareRemote } = require('./temp-git-repo-with-bare-remote.cjs');
const G = require('../lib/global-gitconfig-hash-inputs.cjs');
const { assertKnownGoodBaseline } = require('../lib/git-baseline-gate.cjs');
const I = require('../lib/git-control-files-integrity.cjs');
const H = require('../lib/hardened-git-config-env.cjs');
const ALLOW = require('../lib/child-process-env-allowlist.cjs');

function withEnv(vars, fn) {
  const saved = {}; for (const k of Object.keys(vars)) saved[k] = process.env[k];
  const apply = (o) => { for (const [k, v] of Object.entries(o)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
  apply(vars);
  try { return fn(); } finally { apply(saved); }
}
const git = (repo, hm, ...args) => cp.execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: hm, GIT_CONFIG_NOSYSTEM: '1' } });
const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rig-gc-home-'));
const fwd = (p) => p.replace(/\\/g, '/'); // git config values: a backslash is an escape, so write paths with forward slashes
const rp = (p) => fs.realpathSync.native(p); // hashed include paths are physical (macOS tmp is a symlink)

t.test('M2: fixed set = ~/.gitconfig, ~/.config/git/config, XDG when set and different (deduped)', () => {
  const h = '/hm/u'; const j = path.join; // multi-segment: a lone `/h` is an MSYS drive path on win32
  t.eq(G.fixedGlobalConfigFiles({ HOME: h }), [j(h, '.gitconfig'), j(h, '.config', 'git', 'config')]);
  t.eq(G.fixedGlobalConfigFiles({ HOME: h, XDG_CONFIG_HOME: '/x' }), [j(h, '.gitconfig'), j(h, '.config', 'git', 'config'), j('/x', 'git', 'config')]);
  t.eq(G.fixedGlobalConfigFiles({ HOME: h, XDG_CONFIG_HOME: j(h, '.config') }), [j(h, '.gitconfig'), j(h, '.config', 'git', 'config')]);
});

t.test('H6: MSYS-form HOME resolves to the real drive path on win32, is untouched on POSIX', () => {
  const got = G.fixedGlobalConfigFiles({ HOME: '/c/Users/x' });
  if (process.platform === 'win32') {
    t.eq(got, ['C:\\Users\\x\\.gitconfig', 'C:\\Users\\x\\.config\\git\\config']);
    t.eq(G.fixedGlobalConfigFiles({ HOME: '/d' })[0], 'D:\\.gitconfig');
    t.eq(G.fixedGlobalConfigFiles({ HOME: 'C:\\Users\\y' })[0], 'C:\\Users\\y\\.gitconfig'); // native form is kept
    t.eq(G.fixedGlobalConfigFiles({ HOME: '' })[0], path.join(os.homedir(), '.gitconfig')); // empty -> os.homedir()
    t.eq(G.globalConfigHashParts('/unused', { HOME: '/c/nonexistent-rig-h6' }).length, 2); // same normalized home feeds the hash parts
  } else {
    t.eq(got, ['/c/Users/x/.gitconfig', '/c/Users/x/.config/git/config']);
  }
});

t.test('M2: XDG_CONFIG_HOME is on the env handoff allowlist', () => {
  t.ok(ALLOW.ALLOWED.includes('XDG_CONFIG_HOME'));
  t.eq(ALLOW.pickAllowedEnv({ XDG_CONFIG_HOME: '/x', GH_TOKEN: 'no' }), { XDG_CONFIG_HOME: '/x' });
});

t.test('M2: hash with XDG unset vs set to the same default dir is identical; a custom XDG file changes it', () => {
  const env = makeRepoWithBareRemote({ clones: ['w'] }); const hm = home(); const xdg = home();
  try {
    const repo = env.clone('w');
    withEnv({ HOME: hm, XDG_CONFIG_HOME: undefined }, () => {
      const h0 = I.hashGitControlFiles(repo);
      process.env.XDG_CONFIG_HOME = path.join(hm, '.config');
      t.eq(I.hashGitControlFiles(repo), h0);
      process.env.XDG_CONFIG_HOME = xdg;
      fs.mkdirSync(path.join(xdg, 'git')); fs.writeFileSync(path.join(xdg, 'git', 'config'), '[credential]\n\thelper = !evil\n');
      t.ok(I.hashGitControlFiles(repo) !== h0);
    });
  } finally { env.cleanup(); fs.rmSync(hm, { recursive: true, force: true }); fs.rmSync(xdg, { recursive: true, force: true }); }
});

t.test('M3: edits to an [include] target and an [includeIf] target change the baseline; unrelated file does not', () => {
  const env = makeRepoWithBareRemote({ clones: ['w'] }); const hm = home();
  try {
    const repo = env.clone('w');
    const inc = path.join(hm, 'inc cfg'); const incIf = path.join(hm, 'inc-if'); const other = path.join(hm, 'other');
    fs.writeFileSync(inc, '[user]\n\tname = a\n'); fs.writeFileSync(incIf, '[user]\n\temail = a@b\n'); fs.writeFileSync(other, 'x');
    fs.writeFileSync(path.join(hm, '.gitconfig'), `[include]\n\tpath = "${fwd(inc)}"\n[includeIf "gitdir:${fwd(env.root)}/"]\n\tpath = ${fwd(incIf)}\n`);
    withEnv({ HOME: hm, XDG_CONFIG_HOME: undefined }, () => {
      t.eq(G.globalConfigHashParts(repo).map(([l]) => l.split('\0')[1]).filter(Boolean).sort(), [inc, incIf].map(rp).sort());
      H.knownGoodGitControlBaseline.write(repo);
      t.eq(H.verifyKnownGoodBaseline(repo).status, 'match');
      fs.writeFileSync(other, 'changed');
      t.eq(H.verifyKnownGoodBaseline(repo).status, 'match');
      fs.writeFileSync(inc, '[credential]\n\thelper = !evil\n');
      t.eq(H.verifyKnownGoodBaseline(repo).status, 'mismatch');
      fs.writeFileSync(inc, '[user]\n\tname = a\n');
      t.eq(H.verifyKnownGoodBaseline(repo).status, 'match');
      fs.writeFileSync(incIf, '[url "x"]\n\tinsteadOf = y\n');
      t.eq(H.verifyKnownGoodBaseline(repo).status, 'mismatch');
      fs.writeFileSync(incIf, '[user]\n\temail = a@b\n');
      fs.rmSync(inc); // removing a target is also a change
      t.eq(H.verifyKnownGoodBaseline(repo).status, 'mismatch');
    });
  } finally { env.cleanup(); fs.rmSync(hm, { recursive: true, force: true }); }
});

t.test('R4-M1: hasconfig: includeIf target (active at runtime, invisible to `config --global --list`) is hashed', () => {
  const env = makeRepoWithBareRemote({ clones: ['w'] }); const hm = home();
  try {
    const repo = env.clone('w');
    const tgt = path.join(hm, 'hascfg'); fs.writeFileSync(tgt, '[user]\n\tname = a\n');
    fs.writeFileSync(path.join(hm, '.gitconfig'), `[includeIf "hasconfig:remote.*.url:**"]\n\tpath = ${fwd(tgt)}\n`);
    withEnv({ HOME: hm, XDG_CONFIG_HOME: undefined }, () => {
      H.knownGoodGitControlBaseline.write(repo);
      fs.writeFileSync(tgt, '[credential]\n\thelper = !evil\n');
      t.eq(git(repo, hm, 'config', '--get', 'credential.helper').trim(), '!evil', 'git really applies the include inside the repo');
      t.eq(H.verifyKnownGoodBaseline(repo).status, 'mismatch');
    });
  } finally { env.cleanup(); fs.rmSync(hm, { recursive: true, force: true }); }
});

t.test('R4-M2: onbranch: includeIf no longer makes the hash depend on HEAD (checkout -B keeps the baseline)', () => {
  const env = makeRepoWithBareRemote({ clones: ['w'] }); const hm = home();
  try {
    const repo = env.clone('w');
    const tgt = path.join(hm, 'onbr'); fs.writeFileSync(tgt, '[user]\n\tname = a\n');
    fs.writeFileSync(path.join(hm, '.gitconfig'), `[includeIf "onbranch:rig/*"]\n\tpath = ${fwd(tgt)}\n`);
    withEnv({ HOME: hm, XDG_CONFIG_HOME: undefined }, () => {
      git(repo, hm, 'checkout', '-q', '-B', 'other');
      H.knownGoodGitControlBaseline.write(repo);
      git(repo, hm, 'checkout', '-q', '-B', 'rig/run1');
      t.eq(H.verifyKnownGoodBaseline(repo).status, 'match');
      fs.writeFileSync(tgt, '[credential]\n\thelper = !evil\n');
      t.eq(H.verifyKnownGoodBaseline(repo).status, 'mismatch');
    });
  } finally { env.cleanup(); fs.rmSync(hm, { recursive: true, force: true }); }
});

t.test('R4-M1: relative and ~/ paths, nested includes, cycles, include from the XDG file', () => {
  const hm = home(); const xdg = home();
  try {
    fs.mkdirSync(path.join(hm, 'sub')); fs.mkdirSync(path.join(xdg, 'git'), { recursive: true });
    fs.writeFileSync(path.join(hm, '.gitconfig'), '[include]\n\tpath = sub/a.cfg\n[includeIf "gitdir:/nowhere/"]\n\tpath = ~/tilde.cfg\n');
    fs.writeFileSync(path.join(hm, 'sub', 'a.cfg'), '[include]\n\tpath = b.cfg\n'); // relative to sub/, nested
    fs.writeFileSync(path.join(hm, 'sub', 'b.cfg'), `[include]\n\tpath = ../.gitconfig\n\tpath = ${fwd(path.join(hm, 'sub', 'a.cfg'))}\n\tpath = c.cfg\n`); // cycles + deeper
    fs.writeFileSync(path.join(hm, 'sub', 'c.cfg'), '[user]\n\tname = leaf\n');
    fs.writeFileSync(path.join(hm, 'tilde.cfg'), '[user]\n\tname = t\n');
    fs.writeFileSync(path.join(xdg, 'git', 'config'), '[include]\n\tpath = x.cfg\n');
    fs.writeFileSync(path.join(xdg, 'git', 'x.cfg'), 'x');
    const reached = (e) => G.globalConfigHashParts('/unused', e).map(([l]) => l.split('\0')[1]).filter(Boolean).sort();
    t.eq(reached({ HOME: hm }), ['sub/a.cfg', 'sub/b.cfg', 'sub/c.cfg', 'tilde.cfg'].map((f) => path.join(rp(hm), f)).sort());
    t.eq(reached({ HOME: hm, XDG_CONFIG_HOME: xdg }), [...['sub/a.cfg', 'sub/b.cfg', 'sub/c.cfg', 'tilde.cfg'].map((f) => path.join(rp(hm), f)), path.join(rp(xdg), 'git', 'x.cfg')].sort());
    const h1 = JSON.stringify(G.globalConfigHashParts('/unused', { HOME: hm }));
    fs.writeFileSync(path.join(hm, 'sub', 'c.cfg'), '[user]\n\tname = changed\n');
    t.ok(JSON.stringify(G.globalConfigHashParts('/unused', { HOME: hm })) !== h1, 'deep nested edit changes the parts');
  } finally { fs.rmSync(hm, { recursive: true, force: true }); fs.rmSync(xdg, { recursive: true, force: true }); }
});

t.test('R4-M1: for a config without conditional includes the set equals git\'s own --show-origin --includes listing', () => {
  const hm = home();
  try {
    fs.mkdirSync(path.join(hm, 'd'));
    fs.writeFileSync(path.join(hm, '.gitconfig'), '[user]\n\tname = n\n[include]\n\tpath = d/one\n[INCLUDE]\n\tPATH = ~/two\n');
    fs.writeFileSync(path.join(hm, 'd', 'one'), '[core]\n\tfoo = 1\n[include]\n\tpath = three\n');
    fs.writeFileSync(path.join(hm, 'd', 'three'), '[core]\n\tbar = 1\n');
    fs.writeFileSync(path.join(hm, 'two'), '[core]\n\tbaz = 1\n');
    const out = cp.execFileSync('git', ['config', '--global', '--list', '--show-origin', '--includes', '--name-only', '-z'], { encoding: 'utf8', cwd: hm, env: { PATH: process.env.PATH, HOME: hm, GIT_CONFIG_NOSYSTEM: '1' } });
    const gitSet = new Set(); const p = out.split('\0'); for (let i = 0; i < p.length; i += 2) if (p[i].startsWith('file:')) gitSet.add(rp(p[i].slice(5)));
    const ours = new Set([path.join(rp(hm), '.gitconfig'), ...G.globalConfigHashParts('/unused', { HOME: hm }).map(([l]) => l.split('\0')[1]).filter(Boolean)]);
    t.eq([...ours].sort(), [...gitSet].sort());
  } finally { fs.rmSync(hm, { recursive: true, force: true }); }
});

t.test('R4-M1: parser handles case, quotes, comments, same-line keys, continuation; ~user is a marker', () => {
  const txt = [
    '# [include] path = /nope/commented', '[Include]', '  PATH   =   "/q/quoted path"   ; trailing comment', '  pathx = /nope/other-key',
    '[includeIf "gitdir:/a ] b/"] path = /same/line', '[user]', '  path = /nope/wrong-section', '[core]', '  x = y',
    '[include "sub"]', '  path = /after/subsection # c', '[include]', 'path = ~bob/x', 'path = /cont\\', 'inued',
  ].join('\n');
  const got = G.includePathsOfText(txt);
  for (const want of ['/q/quoted path', '/same/line', '/after/subsection', '~bob/x', '/continued']) t.ok(got.includes(want), `${want} in ${JSON.stringify(got)}`);
  for (const bad of ['/nope/commented', '/nope/other-key', '/nope/wrong-section']) t.ok(!got.includes(bad), bad);
  // a comment ending in a backslash must not hide the following include (both interpretations are unioned)
  t.ok(G.includePathsOfText('; note \\\n[include]\npath = /hidden\n').includes('/hidden'));
  const hm = home();
  try {
    fs.writeFileSync(path.join(hm, '.gitconfig'), '[include]\n\tpath = ~bob/x\n');
    const parts = G.globalConfigHashParts('/unused', { HOME: hm });
    t.ok(parts.some(([, m]) => m === 'unresolvable:~bob/x'));
  } finally { fs.rmSync(hm, { recursive: true, force: true }); }
});

t.test('R4-L1: XDG_CONFIG_HOME="" is treated as unset (hash and git agree)', () => {
  const hm = home();
  try {
    fs.mkdirSync(path.join(hm, '.config', 'git'), { recursive: true });
    fs.writeFileSync(path.join(hm, '.config', 'git', 'config'), '[user]\n\tname = viaxdgdefault\n');
    t.eq(G.fixedGlobalConfigFiles({ HOME: hm, XDG_CONFIG_HOME: '' }), G.fixedGlobalConfigFiles({ HOME: hm }));
    const name = cp.execFileSync('git', ['config', '--global', 'user.name'], { encoding: 'utf8', cwd: hm, env: { PATH: process.env.PATH, HOME: hm, XDG_CONFIG_HOME: '', GIT_CONFIG_NOSYSTEM: '1' } }).trim();
    t.eq(name, 'viaxdgdefault', 'git falls back to ~/.config/git/config for an empty XDG_CONFIG_HOME');
  } finally { fs.rmSync(hm, { recursive: true, force: true }); }
});

t.test('R4-L5: files are hashed in full (no size cap); too many files = non-quarantining RunFailure(prepare)', () => {
  const env = makeRepoWithBareRemote({ clones: ['w'] }); const hm = home();
  try {
    const repo = env.clone('w');
    withEnv({ HOME: hm, XDG_CONFIG_HOME: undefined }, () => {
      t.eq(I.hashGitControlFiles(repo), I.hashGitControlFiles(repo)); // no global config at all is stable
      const big = path.join(hm, 'big'); const body = `[user]\n\tname = n\n${'# pad\n'.repeat(400000)}`; // > 2 MB
      fs.writeFileSync(big, body); fs.writeFileSync(path.join(hm, '.gitconfig'), `[include]\n\tpath = ${fwd(big)}\n`);
      const h0 = I.hashGitControlFiles(repo);
      fs.writeFileSync(big, `${body}[credential]\n\thelper = !evil\n`);
      t.ok(I.hashGitControlFiles(repo) !== h0, 'tail edit of a >1MB file is detected');
      fs.writeFileSync(big, body);
      H.knownGoodGitControlBaseline.write(repo);
      let cfg = '';
      for (let i = 0; i <= G.MAX_INCLUDED; i++) { const f = path.join(hm, `i${i}`); fs.writeFileSync(f, `[user]\n\tname = n${i}\n`); cfg += `[include]\n\tpath = ${fwd(f)}\n`; }
      fs.writeFileSync(path.join(hm, '.gitconfig'), cfg);
      let err = null;
      try { G.globalConfigHashParts(repo); } catch (e) { err = e; }
      t.ok(err && err.name === 'RunFailure' && err.failure === 'prepare' && err.extra.hint, 'overflow throws RunFailure(prepare) with a hint');
      let gateErr = null;
      try { assertKnownGoodBaseline(repo, 'test'); } catch (e) { gateErr = e; }
      t.ok(gateErr && gateErr.failure === 'prepare', 'gate surfaces prepare, not hooks-tampered');
      t.ok(!I.isQuarantined(repo), 'overflow must not quarantine the clone');
    });
  } finally { env.cleanup(); fs.rmSync(hm, { recursive: true, force: true }); }
});

t.test('R5-L1: tokenizer follows git grammar - continuation only inside values (reviewer reproducers)', () => {
  // comment ending in a backslash never continues; the include below it is real and its value continues
  t.ok(G.includePathsOfText('; note \\\n[include]\n\tpath = in\\\nc\n').includes('inc'));
  // `a=\\` (escaped backslash value) ends at the newline, it is not a continuation
  t.ok(G.includePathsOfText('[x]\na=\\\\\n[include]\npath = in\\\nc\n').includes('inc'));
  // continuation, CRLF, BOM, escapes, quotes, bad lines do not crash
  t.eq(G.includePathsOfText('\uFEFF[include]\r\npath = "a\\tb" ; c\r\n'), ['a\tb']);
  t.eq(G.includePathsOfText('[include]\npath = in\\\r\nc\n'), ['inc']);
  t.eq(G.includePathsOfText('[include]\npath = "unterminated\n[include]\npath = ok\n'), ['ok']);
  t.eq(G.includePathsOfText('[ bad\n[include]\npath = bad\\q\npath = good\n'), ['good']);
  t.eq(G.includePathsOfText('[include] path = a\n[includeIf "gitdir:/x\\"y"] path = b\n[user] path = no\n'), ['a', 'b']);
});

t.test('R5-L2: include target is resolved like the kernel (link/.. is physical, not lexical)', () => {
  if (process.platform === 'win32') return; // Win32 path normalization collapses `link\..` lexically (also in git); the physical `..` semantic is a POSIX kernel property
  const hm = home();
  try {
    fs.mkdirSync(path.join(hm, 'real', 'deep'), { recursive: true });
    fs.symlinkSync(path.join(hm, 'real', 'deep'), path.join(hm, 'link'));
    fs.writeFileSync(path.join(hm, 'real', 'x'), '[user]\n\tname = viareal\n');
    fs.writeFileSync(path.join(hm, '.gitconfig'), '[include]\n\tpath = link/../x\n');
    const name = cp.execFileSync('git', ['config', 'user.name'], { encoding: 'utf8', cwd: hm, env: { PATH: process.env.PATH, HOME: hm, GIT_CONFIG_NOSYSTEM: '1' } }).trim();
    t.eq(name, 'viareal', 'git loads real/x');
    const parts = G.globalConfigHashParts('/unused', { HOME: hm });
    t.eq(parts.map(([l]) => l.split('\0')[1]).filter(Boolean), [path.join(rp(hm), 'real', 'x')]);
    const h1 = JSON.stringify(parts);
    fs.writeFileSync(path.join(hm, 'real', 'x'), '[credential]\n\thelper = !evil\n');
    t.ok(JSON.stringify(G.globalConfigHashParts('/unused', { HOME: hm })) !== h1, 'edit of the real target changes the hash');
    // nonexistent target keeps the missing marker
    fs.writeFileSync(path.join(hm, '.gitconfig'), '[include]\n\tpath = link/../nope/y\n');
    const miss = G.globalConfigHashParts('/unused', { HOME: hm }).filter(([l]) => l.startsWith('include'));
    t.eq(miss.map(([, m]) => m), ['missing']);
    t.eq(miss[0][0].split('\0')[1], path.join(rp(hm), 'real', 'nope', 'y'));
  } finally { fs.rmSync(hm, { recursive: true, force: true }); }
});

t.done();
