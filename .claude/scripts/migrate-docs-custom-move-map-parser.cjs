/**
 * Parse and validate `--map <from>=<to>` moves for migrate-docs-to-diataxis-layout.cjs.
 *
 * Used by `/rig:docs restructure`: the agent classifies pages that are not in the
 * fixed legacy map, then passes its decisions here so the migrator moves them and
 * rewrites links exactly like legacy moves. Paths are relative to the docs dir.
 */

const fs = require('fs');
const path = require('path');
const { DIATAXIS_DIRS, PROJECT_DIR, SKIP_DIRS } = require('./docs-diataxis-layout.cjs');

const ALLOWED_TOP_DIRS = [...DIATAXIS_DIRS, PROJECT_DIR];

/** Collect raw `--map a=b` / `--map=a=b` values; returns { maps, rest }. */
function extractMapArgs(argv) {
  const maps = [];
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--map') {
      if (i + 1 >= argv.length) throw new Error('--map needs a value: --map <from>=<to>');
      maps.push(argv[++i]);
    } else if (a.startsWith('--map=')) maps.push(a.slice('--map='.length));
    else rest.push(a);
  }
  return { maps, rest };
}

/** Normalize a docs-relative path; reject absolute, `..`, and empty paths. */
function normalizeRel(p, label) {
  const norm = path.posix.normalize(String(p || '').trim().replace(/\\/g, '/')).replace(/\/+$/, '');
  if (!norm || norm === '.' || norm.startsWith('/') || norm.split('/').includes('..')) {
    throw new Error(`invalid ${label} path in --map: "${p}" (must be relative to the docs dir, no "..")`);
  }
  return norm;
}

/**
 * Validate raw map strings against docsDir -> [{ from, to, type }].
 * Rules: source exists; target sits under (or, for a dir, is) a Diataxis dir or project/; files keep
 * `.md`; no skipped dirs; no duplicate sources.
 */
function parseCustomMoves(rawMaps, docsDir) {
  const seen = new Set();
  return rawMaps.map(raw => {
    const eq = String(raw).indexOf('=');
    if (eq <= 0) throw new Error(`invalid --map "${raw}" (expected <from>=<to>)`);
    const from = normalizeRel(raw.slice(0, eq), 'source');
    const to = normalizeRel(raw.slice(eq + 1), 'target');
    if (seen.has(from)) throw new Error(`duplicate --map source: ${from}`);
    seen.add(from);

    let stat;
    try { stat = fs.statSync(path.join(docsDir, from)); } catch (e) {
      throw new Error(`--map source not found: ${path.basename(docsDir)}/${from}`);
    }
    const type = stat.isDirectory() ? 'dir' : 'file';
    const parts = to.split('/');
    if (!ALLOWED_TOP_DIRS.includes(parts[0]) || (parts.length < 2 && type === 'file')) {
      throw new Error(`--map target must be under ${ALLOWED_TOP_DIRS.join('/, ')}/: ${to}`);
    }
    if ([...from.split('/'), ...parts].some(seg => SKIP_DIRS.includes(seg))) {
      throw new Error(`--map may not touch skipped dirs (${SKIP_DIRS.join(', ')}): ${from} -> ${to}`);
    }
    if (type === 'file' && (!from.endsWith('.md') || !to.endsWith('.md'))) {
      throw new Error(`--map file moves must be .md -> .md: ${from} -> ${to}`);
    }
    if (from === to) throw new Error(`--map source equals target: ${from}`);
    return { from, to, type };
  });
}

module.exports = { extractMapArgs, parseCustomMoves, ALLOWED_TOP_DIRS };
