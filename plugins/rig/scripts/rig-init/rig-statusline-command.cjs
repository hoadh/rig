'use strict';
/**
 * Recognizes the statusLine command a Rig 1.x global install wrote (`node "$HOME/.claude/statusline.cjs"` and its
 * spellings), so `rig-init --runtime` may point it at the runtime copy instead of keeping it as the user's own.
 * Accepted roots: `$HOME`, `${HOME}`, `$USERPROFILE`, `%USERPROFILE%`, `~`, the home path (lexical or real), or
 * `$CLAUDE_CONFIG_DIR` / `%CLAUDE_CONFIG_DIR%` (already the `.claude` dir). Either separator; quotes ignored.
 */
const fs = require('fs');

const FOLD_CASE = process.platform === 'win32' || process.platform === 'darwin';
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const slashes = (p) => escapeRe(p.replace(/\\/g, '/')).replace(/\//g, '[/\\\\]');

/** True when `command` runs `<home>/.claude/statusline.cjs`. */
function isRig1xStatusLineCommand(command, home) {
  if (typeof command !== 'string') return false;
  const clean = command.replace(/["']/g, '');
  const homes = [home];
  try { homes.push(fs.realpathSync(home)); } catch { /* not on disk */ }
  const underHome = ['\\$\\{?HOME\\}?', '\\$\\{?USERPROFILE\\}?', '%USERPROFILE%', '~', ...homes.filter(Boolean).map(slashes)];
  const direct = ['\\$\\{?CLAUDE_CONFIG_DIR\\}?', '%CLAUDE_CONFIG_DIR%'];
  const lead = '(?<=^|[\\s=:(;&|,])';
  const end = '(?=$|[\\s;&|)])';
  const sources = [
    ...underHome.map((r) => `${lead}${r}[/\\\\]\\.claude[/\\\\]statusline\\.cjs${end}`),
    ...direct.map((r) => `${lead}${r}[/\\\\]statusline\\.cjs${end}`),
  ];
  return sources.some((src) => new RegExp(src, FOLD_CASE ? 'i' : '').test(clean));
}

module.exports = { isRig1xStatusLineCommand };
