/**
 * bash-in-place-edit-symlink-rule.cjs - rule `in-place-edit-symlink`.
 *
 * `sed -i` / `perl -i` write a temp file and rename it over the target, so a symlink (e.g. a
 * stow-managed dotfile) silently becomes a regular file. This rule lstat()s every file operand
 * of an in-place edit and only reacts to a CONFIRMED symlink:
 *   - cwd known (or absolute operand) -> deny
 *   - relative operand with unknown cwd (`cd "$D" && ...`) -> ask
 *   - win32 -> ask, never deny: MSYS paths and `ln -s` copies make lstat unreliable there
 * Operands with variables/globs are skipped. GNU sed (`sed` on linux, `gsed` anywhere) has
 * --follow-symlinks; BSD/macOS sed and perl do not, so their remedy is to edit the real target.
 *
 * Contract: opaquePolicy 'skip' (nothing to inspect in `$(...)` text), crashPolicy 'allow'.
 */
const fs = require('fs');
const path = require('path');
const { commandName, expandHome } = require('./bash-command-segment-tokenizer.cjs');

// perl switches that take the rest of the cluster as their value (stop scanning the cluster).
const PERL_ATTACHED = new Set(['0', 'l', 'M', 'm', 'F', 'C', 'D', 'd', 'x', 'V']);

/**
 * Parses sed/perl argv.
 * @returns {{inPlace: boolean, follow: boolean, operands: Array<{text: string, dynamic: boolean}>}}
 */
function parseInPlaceArgs(name, args, dynamic) {
  const isPerl = name === 'perl';
  const out = { inPlace: false, follow: false, operands: [] };
  let scriptGiven = false; // -e/-f/--expression/--file seen: no positional script
  let endOfOptions = false;
  const positional = [];

  for (let i = 0; i < args.length; i += 1) {
    const t = args[i];
    if (endOfOptions || t === '-' || t[0] !== '-') {
      positional.push({ text: t, dynamic: Boolean(dynamic[i]) });
      continue;
    }
    if (t === '--') {
      endOfOptions = true;
      continue;
    }
    if (t.startsWith('--')) {
      const long = t.slice(2).split('=')[0];
      if (long === 'in-place') out.inPlace = true;
      else if (long === 'follow-symlinks') out.follow = true;
      else if (long === 'expression' || long === 'file') {
        scriptGiven = true;
        if (!t.includes('=')) i += 1; // value is the next word
      }
      continue;
    }
    // short option cluster
    for (let k = 1; k < t.length; k += 1) {
      const ch = t[k];
      if (ch === 'i') {
        out.inPlace = true;
        break; // rest of the cluster is the backup suffix
      }
      const takesValue = isPerl ? (ch === 'e' || ch === 'E' || ch === 'I') : (ch === 'e' || ch === 'f' || ch === 'l');
      if (takesValue) {
        if (ch !== 'l' && ch !== 'I') scriptGiven = true;
        if (k === t.length - 1) i += 1; // value is the next word
        break;
      }
      if (isPerl && PERL_ATTACHED.has(ch)) break;
    }
  }
  // Without -e/-f the first positional is the script (sed) or script file (perl), not a target.
  out.operands = scriptGiven ? positional : positional.slice(1);
  return out;
}

function lstatSymlink(file) {
  try {
    return fs.lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}

function realTarget(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    return null;
  }
}

function remedy(name, platform, shown, target) {
  const real = target || `the symlink target (readlink -f ${shown})`;
  const gnuSed = name === 'gsed' || (name === 'sed' && platform === 'linux');
  if (gnuSed) return `Edit the target ${real} directly, or use: ${name} --follow-symlinks -i ...`;
  return `Edit the target ${real} directly (${name === 'perl' ? 'perl' : 'BSD sed'} has no flag to follow symlinks).`;
}

function check(segment, ctx) {
  const name = commandName(segment);
  if (name !== 'sed' && name !== 'gsed' && name !== 'perl') return null;
  const parsed = parseInPlaceArgs(name, segment.argv.slice(1), (segment.dynamic || []).slice(1));
  if (!parsed.inPlace || (name !== 'perl' && parsed.follow)) return null;

  const platform = ctx.platform || process.platform;
  let ask = null;
  for (const operand of parsed.operands) {
    if (operand.dynamic || operand.text === '') continue;
    const expanded = expandHome(operand.text);
    const relative = !path.isAbsolute(expanded);
    const abs = relative ? path.resolve(ctx.cwd || process.cwd(), expanded) : expanded;
    if (!lstatSymlink(abs)) continue;

    const shown = path.basename(abs);
    const base = `'${shown}' is a symlink; ${name} -i would replace it with a regular file.`;
    if (platform === 'win32' || (relative && ctx.cwdUnknown)) {
      ask = ask || {
        decision: 'ask',
        reason: `${base} ${remedy(name, platform, shown, realTarget(abs))}`,
        context: `${base} ${remedy(name, platform, shown, realTarget(abs))}`,
      };
      continue;
    }
    return { decision: 'deny', reason: `${base} ${remedy(name, platform, shown, realTarget(abs))}` };
  }
  return ask;
}

module.exports = {
  id: 'in-place-edit-symlink',
  configKey: 'inPlaceEditSymlink',
  opaquePolicy: 'skip',
  crashPolicy: 'allow',
  check,
  parseInPlaceArgs,
};
