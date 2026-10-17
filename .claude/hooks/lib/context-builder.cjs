#!/usr/bin/env node
/**
 * context-builder.cjs - Per-prompt context for the dev-rules-reminder hook
 *
 * Only dynamic facts go here: date/time, resolved paths, plan context and the
 * naming pattern. Static guidance (YAGNI/KISS/DRY, modularization, report style)
 * lives in .claude/rules/*.md and CLAUDE.md, which Claude Code loads natively.
 *
 * @module context-builder
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const {
  loadConfig,
  resolvePlanPath,
  getReportsPath,
  resolveNamingPattern,
  normalizePath
} = require('./rig-config-utils.cjs');

// First header of the reminder; also the marker wasRecentlyInjected() looks for
const REMINDER_MARKER = '## Rig Session';

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Safely execute a command
 * @param {string} cmd - Command to execute
 * @returns {string|null} Output or null on error
 */
function execSafe(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    return null;
  }
}

/**
 * Resolve skills venv Python path (local or global)
 * @param {string} [configDirName='.claude'] - Config directory name
 * @returns {string|null} Resolved venv Python path or null
 */
function resolveSkillsVenv(configDirName = '.claude') {
  const isWindows = process.platform === 'win32';
  const venvBin = isWindows ? 'Scripts' : 'bin';
  const pythonExe = isWindows ? 'python.exe' : 'python3';

  const localVenv = path.join(process.cwd(), configDirName, 'skills', '.venv', venvBin, pythonExe);
  const globalVenv = path.join(os.homedir(), '.claude', 'skills', '.venv', venvBin, pythonExe);

  if (fs.existsSync(localVenv)) {
    return isWindows
      ? `${configDirName}\\skills\\.venv\\Scripts\\python.exe`
      : `${configDirName}/skills/.venv/bin/python3`;
  }
  if (fs.existsSync(globalVenv)) {
    return isWindows
      ? '~\\.claude\\skills\\.venv\\Scripts\\python.exe'
      : '~/.claude/skills/.venv/bin/python3';
  }
  return null;
}

/**
 * Build plan context from config and git info
 * @param {string|null} sessionId - Session ID
 * @param {Object} config - Loaded config
 * @returns {Object} Plan context object
 */
function buildPlanContext(sessionId, config) {
  const { plan, paths } = config;
  const gitBranch = execSafe('git branch --show-current');
  const resolved = resolvePlanPath(sessionId, config);
  const reportsPath = getReportsPath(resolved.path, resolved.resolvedBy, plan, paths);
  const namePattern = resolveNamingPattern(plan, gitBranch);

  const planLine = resolved.resolvedBy === 'session'
    ? `- Plan: ${resolved.path}`
    : resolved.resolvedBy === 'branch'
      ? `- Plan: none | Suggested: ${resolved.path}`
      : `- Plan: none`;

  const validation = plan.validation || {};
  const validationMode = validation.mode || 'prompt';
  const validationMin = validation.minQuestions || 3;
  const validationMax = validation.maxQuestions || 8;

  return { reportsPath, gitBranch, planLine, namePattern, validationMode, validationMin, validationMax };
}

/**
 * Check if the reminder was injected within the last few prompts
 * @param {string} transcriptPath - Path to transcript file
 * @returns {boolean} true if recently injected
 */
function wasRecentlyInjected(transcriptPath) {
  try {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return false;
    const transcript = fs.readFileSync(transcriptPath, 'utf-8');
    return transcript.split('\n').slice(-150).some(line => line.includes(REMINDER_MARKER));
  } catch (e) {
    return false;
  }
}

/**
 * Join a possibly-absolute path onto baseDir without doubling it
 * (path.join('/a', '/a/b') gives '/a/a/b'; path.resolve gives '/a/b').
 * Keeps a trailing separator when the input had one.
 */
function toAbsolute(baseDir, p) {
  if (!baseDir) return p;
  const abs = path.resolve(baseDir, p);
  return /[\\/]$/.test(p) ? abs + path.sep : abs;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION BUILDERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build session section (date/time and, if configured, thinking language).
 * Response language is left to Claude Code's native `language` setting.
 * @param {Object} params
 * @param {string} [params.thinkingLanguage] - Language for reasoning
 * @param {Object} [params.staticEnv] - Pre-computed static environment info
 * @returns {string[]} Lines for session section
 */
function buildSessionSection({ thinkingLanguage, staticEnv = {} } = {}) {
  const timezone = staticEnv.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const lines = [
    REMINDER_MARKER,
    `- DateTime: ${new Date().toLocaleString()} (${timezone})`
  ];
  if (thinkingLanguage) {
    lines.push(`- Thinking language: ${thinkingLanguage}`);
  }
  lines.push(``);
  return lines;
}

/**
 * Build paths section
 * @param {Object} params
 * @param {string} params.reportsPath - Reports path
 * @param {string} params.plansPath - Plans path
 * @param {string} params.docsPath - Docs path
 * @param {number} [params.docsMaxLoc=800] - Max lines per doc file
 * @param {string} [params.skillsVenv] - Skills venv Python path
 * @returns {string[]} Lines for paths section
 */
function buildPathsSection({ reportsPath, plansPath, docsPath, docsMaxLoc = 800, skillsVenv }) {
  const lines = [
    `## Paths`,
    `- Reports: ${reportsPath} | Plans: ${plansPath}/ | Docs: ${docsPath}/ | docs.maxLoc: ${docsMaxLoc}`,
    `- Markdown files go in Plans or Docs unless the user asks otherwise`
  ];
  if (skillsVenv) {
    lines.push(`- Skills Python: \`${skillsVenv}\``);
  }
  lines.push(``);
  return lines;
}

/**
 * Build plan context section
 * @param {Object} params
 * @param {string} params.planLine - Plan status line
 * @param {string} [params.gitBranch] - Git branch
 * @param {string} params.validationMode - Validation mode
 * @param {number} params.validationMin - Min questions
 * @param {number} params.validationMax - Max questions
 * @returns {string[]} Lines for plan context section
 */
function buildPlanContextSection({ planLine, gitBranch, validationMode, validationMin, validationMax }) {
  const lines = [`## Plan Context`, planLine];
  if (gitBranch) {
    lines.push(`- Branch: ${gitBranch}`);
  }
  lines.push(`- Validation: mode=${validationMode}, questions=${validationMin}-${validationMax}`);
  lines.push(``);
  return lines;
}

/**
 * Build naming section
 * @param {Object} params
 * @param {string} params.reportsPath - Reports path
 * @param {string} params.plansPath - Plans path
 * @param {string} params.namePattern - Naming pattern
 * @returns {string[]} Lines for naming section
 */
function buildNamingSection({ reportsPath, plansPath, namePattern }) {
  return [
    `## Naming`,
    `- Report: \`${reportsPath}{type}-${namePattern}.md\``,
    `- Plan dir: \`${plansPath}/${namePattern}/\``,
    `- \`{type}\`: agent name or report type; \`{slug}\`: descriptive-kebab-slug`
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build the per-prompt reminder
 *
 * @param {Object} [params]
 * @param {string} [params.sessionId] - Session ID
 * @param {Object} [params.config] - Rig config (auto-loaded if not provided)
 * @param {Object} [params.staticEnv] - Pre-computed static environment info
 * @param {string} [params.configDirName='.claude'] - Config directory name
 * @param {string} [params.baseDir] - Project directory; paths become absolute against it
 * @returns {{ content: string, lines: string[], sections: Object }}
 */
function buildReminderContext({ sessionId, config, staticEnv, configDirName = '.claude', baseDir } = {}) {
  const cfg = config || loadConfig({ includeProject: false, includeAssertions: false });
  const planCtx = buildPlanContext(sessionId, cfg);

  const plansPath = toAbsolute(baseDir, normalizePath(cfg.paths?.plans) || 'plans');
  const docsPath = toAbsolute(baseDir, normalizePath(cfg.paths?.docs) || 'docs');
  const reportsPath = toAbsolute(baseDir, planCtx.reportsPath);

  const sections = {
    session: buildSessionSection({ thinkingLanguage: cfg.locale?.thinkingLanguage, staticEnv }),
    paths: buildPathsSection({
      reportsPath,
      plansPath,
      docsPath,
      docsMaxLoc: Math.max(1, parseInt(cfg.docs?.maxLoc, 10) || 800),
      skillsVenv: resolveSkillsVenv(configDirName)
    }),
    planContext: buildPlanContextSection(planCtx),
    naming: buildNamingSection({ reportsPath, plansPath, namePattern: planCtx.namePattern })
  };

  const lines = [...sections.session, ...sections.paths, ...sections.planContext, ...sections.naming];
  return { content: lines.join('\n'), lines, sections };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  REMINDER_MARKER,
  buildReminderContext,

  // Section builders
  buildSessionSection,
  buildPathsSection,
  buildPlanContextSection,
  buildNamingSection,

  // Helpers
  execSafe,
  resolveSkillsVenv,
  buildPlanContext,
  wasRecentlyInjected,
  toAbsolute
};
