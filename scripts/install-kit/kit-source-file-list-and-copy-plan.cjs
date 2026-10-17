/**
 * Builds the list of kit files to install and where each one goes:
 *   local  → <project>/.claude/**, <project>/CLAUDE.md, AGENTS.md, .repomixignore, .gitignore, plans/templates/**
 *   global → ~/.claude/** (contents of .claude/) and ~/.claude/CLAUDE.md
 * Source files come from git (tracked + untracked-not-ignored), so ignored runtime state
 * (.env, hook logs, session state, venvs, caches) never leaves the repo.
 */
const { execFileSync } = require('child_process');
const path = require('path');

// Never copied: secrets, VCS/dependency dirs, OS junk, logs and per-machine state
const NEVER_COPY = [
  /(^|\/)\.env$/, /(^|\/)\.env\.local$/, /(^|\/)\.env\.[^/]*\.local$/, /\.(key|pem|p12)$/i,
  /(^|\/)(node_modules|\.git|\.github|\.venv|venv|__pycache__)\//, /(^|\/)(\.DS_Store|Thumbs\.db)$/, /\.log$/,
  // per-machine files that must never be pushed into another install
  /^\.claude\/settings\.local\.json$/, /^\.claude\/hooks\/\.logs\//,
];

// User config: copied only when the target does not have it yet
const PRESERVE_IF_EXISTS = new Set(['.gitignore', '.repomixignore', '.mcp.json', '.rig.json', 'CLAUDE.md', 'AGENTS.md']);

const LOCAL_ROOT_FILES = ['CLAUDE.md', 'AGENTS.md', '.repomixignore', '.gitignore', '.mcp.json'];
const LOCAL_ROOT_DIR_PREFIXES = ['plans/templates/'];

function listRepoFiles(kitRoot) {
  let out;
  try {
    out = execFileSync('git', ['-C', kitRoot, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    throw new Error(`Cannot list kit files with git in ${kitRoot}; run from a git clone of the kit (${err.message.split('\n')[0]})`);
  }
  return [...new Set(out.split('\0').filter(Boolean))];
}

function isKitFileForMode(relPath, isGlobal) {
  if (relPath.startsWith('.claude/')) return true;
  if (isGlobal) return relPath === 'CLAUDE.md';
  return LOCAL_ROOT_FILES.includes(relPath) || LOCAL_ROOT_DIR_PREFIXES.some((p) => relPath.startsWith(p));
}

/**
 * @returns {Array<{ rel: string, src: string, dest: string, kind: 'settings'|'preserve'|'copy' }>}
 */
function buildCopyPlan({ kitRoot, targetRoot, isGlobal, fs }) {
  const plan = [];
  for (const rel of listRepoFiles(kitRoot)) {
    if (!isKitFileForMode(rel, isGlobal) || NEVER_COPY.some((re) => re.test(rel))) continue;
    const src = path.join(kitRoot, rel);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue; // deleted-but-tracked files
    // Global installs flatten `.claude/` into ~/.claude itself; CLAUDE.md lands next to it
    const destRel = isGlobal ? rel.replace(/^\.claude\//, '') : rel;
    const dest = path.join(targetRoot, destRel);
    const isSettings = destRel === (isGlobal ? 'settings.json' : '.claude/settings.json');
    // Only top-level user config is protected (project root or .claude/), not files nested in skills
    const isTopLevel = !rel.replace(/^\.claude\//, '').includes('/');
    const kind = isSettings ? 'settings' : isTopLevel && PRESERVE_IF_EXISTS.has(path.basename(rel)) ? 'preserve' : 'copy';
    plan.push({ rel, src, dest, kind });
  }
  return plan;
}

module.exports = { buildCopyPlan };
