/**
 * Builds the list of kit files to install and where each one goes:
 *   local  → <project>/.claude/**, <project>/CLAUDE.md, AGENTS.md, .repomixignore, .gitignore
 *   global → ~/.claude/** (contents of .claude/) and ~/.claude/CLAUDE.md
 * Sources (since 2.0): the kit lives in plugins/rig/ and installs to `.claude/<same path>`; the plugin-only
 * files (.claude-plugin/, hooks/hooks.json) stay out; the repo's own `.claude/` supplies the user-config files
 * (.rig.json, .env.example, .mcp.json.example, .gitignore). settings.json is generated from the plugin's hooks.json
 * (install-settings-template-from-plugin-hooks.cjs), because the repo's `.claude/settings.json` is dev-only.
 * Source files come from git (tracked + untracked-not-ignored), so ignored runtime state
 * (.env, hook logs, session state, venvs, caches) never leaves the repo.
 */
const { execFileSync } = require('child_process');
const path = require('path');
const { buildInstallSettingsTemplate } = require('./install-settings-template-from-plugin-hooks.cjs');

const PLUGIN_PREFIX = 'plugins/rig/';
// Plugin files with no meaning in a file install
const PLUGIN_ONLY = [/^plugins\/rig\/\.claude-plugin\//, /^plugins\/rig\/hooks\/hooks\.json$/];

// Never copied: secrets, VCS/dependency dirs, OS junk, logs and per-machine state
const NEVER_COPY = [
  /(^|\/)\.env$/, /(^|\/)\.env\.local$/, /(^|\/)\.env\.[^/]*\.local$/, /\.(key|pem|p12)$/i,
  /(^|\/)(node_modules|\.git|\.github|\.venv|venv|__pycache__)\//, /(^|\/)(\.DS_Store|Thumbs\.db)$/, /\.log$/,
  // per-machine files that must never be pushed into another install
  /^\.claude\/settings\.local\.json$/, /^plugins\/rig\/hooks\/\.logs\//,
];

// User config: copied only when the target does not have it yet
const PRESERVE_IF_EXISTS = new Set(['.gitignore', '.repomixignore', '.mcp.json', '.rig.json', 'CLAUDE.md', 'AGENTS.md']);

const LOCAL_ROOT_FILES = ['CLAUDE.md', 'AGENTS.md', '.repomixignore', '.gitignore', '.mcp.json'];

function listRepoFiles(kitRoot) {
  let out;
  try {
    out = execFileSync('git', ['-C', kitRoot, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    throw new Error(`Cannot list kit files with git in ${kitRoot}; run from a git clone of the kit (${err.message.split('\n')[0]})`, { cause: err });
  }
  return [...new Set(out.split('\0').filter(Boolean))];
}

/**
 * Path of a repo file inside the installed `.claude/` dir, or null when it is not a kit file for this mode.
 * `plugins/rig/x` and `.claude/x` both map to `x`; the repo's dev-only `.claude/settings.json` is replaced by
 * the generated template under the same installed name.
 */
function installRelFor(relPath, isGlobal) {
  if (relPath.startsWith(PLUGIN_PREFIX)) return PLUGIN_ONLY.some((re) => re.test(relPath)) ? null : relPath.slice(PLUGIN_PREFIX.length);
  if (relPath.startsWith('.claude/')) return relPath.slice('.claude/'.length);
  if (isGlobal) return relPath === 'CLAUDE.md' ? relPath : null;
  return LOCAL_ROOT_FILES.includes(relPath) ? relPath : null;
}

/**
 * @returns {Array<{ rel: string, src: string, dest: string, kind: 'settings'|'preserve'|'copy', content?: string }>}
 *   `content` is set for the generated settings item.
 */
function buildCopyPlan({ kitRoot, targetRoot, isGlobal, fs }) {
  const plan = [];
  const claudeFiles = new Set();
  for (const rel of listRepoFiles(kitRoot)) {
    const installRel = installRelFor(rel, isGlobal);
    if (installRel === null || NEVER_COPY.some((re) => re.test(rel))) continue;
    const src = path.join(kitRoot, rel);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue; // deleted-but-tracked files
    const isRootFile = !rel.startsWith(PLUGIN_PREFIX) && !rel.startsWith('.claude/');
    // Global installs flatten `.claude/` into ~/.claude itself; CLAUDE.md lands next to it
    const destRel = isGlobal || isRootFile ? installRel : `.claude/${installRel}`;
    if (!isRootFile) {
      if (claudeFiles.has(installRel)) throw new Error(`two kit sources map to .claude/${installRel}`);
      claudeFiles.add(installRel);
    }
    const dest = path.join(targetRoot, destRel);
    const isSettings = !isRootFile && installRel === 'settings.json';
    // Only top-level user config is protected (project root or .claude/), not files nested in skills
    const isTopLevel = !installRel.includes('/');
    const kind = isSettings ? 'settings' : isTopLevel && PRESERVE_IF_EXISTS.has(path.basename(rel)) ? 'preserve' : 'copy';
    const item = { rel, src, dest, kind };
    if (isSettings) item.content = buildInstallSettingsTemplate({ kitRoot, fs });
    plan.push(item);
  }
  return plan;
}

module.exports = { buildCopyPlan, installRelFor };
