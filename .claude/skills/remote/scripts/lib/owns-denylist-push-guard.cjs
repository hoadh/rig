'use strict';
/**
 * Hard pre-push guard (shared by the runner and, in phase 05, `collect`).
 * Rules for every path changed between base and head:
 *  1. must match some `owns` glob (own matcher: `**`, `*`, `?`; no deps)
 *  2. CI/hook/agent-config paths (denylist) additionally need an `owns` glob
 *     whose literal prefix lies inside that area - a catch-all `**` never counts
 *  3. symlink (120000) and gitlink (160000) changes are always rejected
 *  4. paths with control chars are rejected outright
 * Matching is case-insensitive with '\\' folded to '/', because macOS/Windows
 * checkouts are case-insensitive (`.GITHUB/workflows` IS `.github/workflows`).
 */
const { safeGit } = require('./safe-git-runner.cjs');

const DENYLIST = [
  '.github/**', '.claude/**', '.gitlab-ci.yml', '.circleci/**', 'azure-pipelines.yml', 'Jenkinsfile',
  '.husky/**', '.githooks/**', '.pre-commit-config.yaml', 'lefthook.yml', '.gitattributes', '.gitmodules',
  // agent / editor / tool configs that execute or steer code when a human or agent opens the repo
  '**/.mcp.json', '**/CLAUDE.md', '**/.vscode/**', '**/.cursor/**', '**/.envrc', '**/.npmrc', '**/.yarnrc*',
];
const SPECIAL_MODES = new Set(['120000', '160000']);

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
/** Case-fold + separator-fold: the form used for every comparison. */
const normalize = (s) => String(s).replace(/\\/g, '/').toLowerCase();

/**
 * Glob -> RegExp. `**` crosses '/', `*` and `?` do not; `**` + '/' may match zero dirs.
 * `[\s\S]` (not `.`) so a newline in a path cannot dodge a wildcard; consecutive
 * `**` / `**\/` runs collapse so a hostile glob cannot cause catastrophic backtracking.
 */
function globToRegExp(glob) {
  const g = normalize(glob).replace(/(?:\*\*\/)+/g, '**/').replace(/\*{2,}/g, '**');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') { i++; re += '(?:[\\s\\S]*/)?'; } else re += '[\\s\\S]*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

const globMatches = (glob, p) => globToRegExp(glob).test(normalize(p));

/** Literal part of a glob before its first wildcard. */
const literalPrefix = (glob) => { const g = normalize(glob); const i = g.search(/[*?]/); return g.slice(0, i === -1 ? g.length : i); };

/** Does an owns glob explicitly reach into a denylisted area (its literal prefix is inside it)? */
function ownsGrantsDenylisted(ownsGlob, denyGlob) {
  const lit = literalPrefix(ownsGlob);
  if (!lit) return false;
  return globMatches(denyGlob, lit) || globMatches(denyGlob, `${lit}x`);
}

/** Parse `git diff --raw -z --no-renames` output into [{path, status, oldMode, newMode}]. */
function parseRawDiff(out) {
  const parts = out.split('\0');
  const changes = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const m = /^:(\d+) (\d+) [0-9a-f]+ [0-9a-f]+ ([A-Z])/.exec(parts[i]);
    if (m) changes.push({ path: parts[i + 1], oldMode: m[1], newMode: m[2], status: m[3] });
  }
  return changes;
}

/** Pure rule evaluation. @returns {{path:string, rule:string, detail:string}[]} */
function evaluateChanges(changes, owns) {
  const violations = [];
  for (const c of changes) {
    if (SPECIAL_MODES.has(c.oldMode) || SPECIAL_MODES.has(c.newMode)) {
      violations.push({ path: c.path, rule: 'symlink-or-gitlink', detail: `mode ${c.oldMode}->${c.newMode}` });
      continue;
    }
    if (CONTROL_CHARS.test(c.path)) {
      violations.push({ path: JSON.stringify(c.path), rule: 'control-chars', detail: 'path contains control characters' });
      continue;
    }
    const matching = owns.filter((g) => globMatches(g, c.path));
    if (!matching.length) {
      violations.push({ path: c.path, rule: 'not-owned', detail: `matches none of: ${owns.join(', ')}` });
      continue;
    }
    const deny = DENYLIST.find((d) => globMatches(d, c.path));
    if (deny && !matching.some((g) => ownsGrantsDenylisted(g, deny))) {
      violations.push({ path: c.path, rule: 'denylisted', detail: `protected area ${deny}; needs an explicit owns glob inside it` });
    }
  }
  return violations;
}

/** Check base..head in `repo` against owns + denylist. Empty array = ok. */
function checkOwnsAndDenylist(repo, baseSha, headSha, owns) {
  const out = safeGit(repo, ['diff', '--raw', '-z', '--no-renames', '--no-abbrev', baseSha, headSha]);
  return evaluateChanges(parseRawDiff(out), owns);
}

module.exports = { DENYLIST, globToRegExp, globMatches, ownsGrantsDenylisted, parseRawDiff, evaluateChanges, checkOwnsAndDenylist };
