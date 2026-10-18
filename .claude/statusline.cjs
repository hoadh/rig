#!/usr/bin/env node
'use strict';

/**
 * Custom Claude Code statusline for Node.js - Multi-line Edition
 * Cross-platform support: Windows, macOS, Linux
 * Features: 256-color theme, gradient bars, effort level, context window, 5h/7d rate limits,
 *           cost/time/tokens, git state, tool/agent/todo tracking
 * No external dependencies - uses only Node.js built-in modules
 */

const { stdin, env } = require('process');
const os = require('os');
const fs = require('fs');
const path = require('path');

// Import modular components
const { setColorEnabled } = require('./hooks/lib/colors.cjs');
const { parseTranscript } = require('./hooks/lib/transcript-parser.cjs');
const { countConfigs } = require('./hooks/lib/config-counter.cjs');
const { loadConfig } = require('./hooks/lib/rig-config-utils.cjs');
const { getGitInfo } = require('./hooks/lib/git-info-cache.cjs');
const { expandHome } = require('./hooks/lib/statusline-text-formatters.cjs');
const seg = require('./hooks/lib/statusline-segment-renderers.cjs');

// Buffer constant for fallback context calculation
const AUTOCOMPACT_BUFFER = 40000;

/**
 * Get terminal width with fallback chain
 * Piped context (statusline) needs alternative detection
 */
function getTerminalWidth() {
  // Try multiple sources - stderr might still be TTY even when stdout is piped
  if (process.stderr.columns) return process.stderr.columns;
  if (env.COLUMNS) {
    const parsed = parseInt(env.COLUMNS, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 120; // Safe default
}

/**
 * Read stdin asynchronously.
 * Optional inactivity timeout can be enabled via RIG_STATUSLINE_STDIN_TIMEOUT_MS.
 */
async function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stdin.setEncoding('utf8');

    const parsedTimeout = Number.parseInt(env.RIG_STATUSLINE_STDIN_TIMEOUT_MS || '', 10);
    const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 0;
    let timer = null;

    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const armTimer = () => {
      if (!timeoutMs) return;
      clearTimer();
      timer = setTimeout(() => {
        reject(new Error(`stdin read timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    };

    armTimer();
    stdin.on('data', chunk => {
      chunks.push(chunk);
      armTimer();
    });
    stdin.on('end', () => {
      clearTimer();
      resolve(chunks.join(''));
    });
    stdin.on('error', (err) => {
      clearTimer();
      reject(err);
    });
  });
}

/**
 * Parse one rate-limit window from stdin `rate_limits.{five_hour|seven_day}`
 * ({ used_percentage, resets_at: epoch seconds }). Absent for API-key users.
 * @returns {{percent: number|null, resetSec: number}|null}
 */
function parseLimitWindow(window, nowSec = Math.floor(Date.now() / 1000)) {
  if (!window || typeof window !== 'object') return null;
  const percent = typeof window.used_percentage === 'number' ? window.used_percentage : null;
  const remaining = Number(window.resets_at) - nowSec;
  return { percent, resetSec: remaining > 0 ? remaining : 0 };
}

// ============================================================================
// RENDER MODES
// ============================================================================

/**
 * Full mode: AI session row, workspace row, then activity rows.
 * Each row wraps by segment to fit the terminal.
 */
function renderFull(ctx) {
  const maxWidth = Math.max(30, Math.floor(getTerminalWidth() * 0.85));

  const sessionRow = [
    seg.modelSegment(ctx),
    seg.effortSegment(ctx),
    seg.contextSegment(ctx),
    seg.limitSegment('5h', ctx.fiveHour, true),
    seg.limitSegment('7d', ctx.sevenDay, false),
    seg.metricsSegment(ctx)
  ];
  const workspaceRow = [
    seg.dirSegment(ctx),
    seg.gitSegment(ctx),
    ctx.activePlan ? `◎ ${ctx.activePlan}` : '',
    seg.changesSegment(ctx),
    seg.configSegment(ctx),
    seg.envSegment(ctx)
  ];

  const lines = [
    ...seg.wrapSegments(sessionRow, maxWidth),
    ...seg.wrapSegments(workspaceRow, maxWidth)
  ];

  const toolsLine = seg.renderToolsLine(ctx.transcript);
  if (toolsLine) lines.push(toolsLine);
  lines.push(...seg.renderAgentsLines(ctx.transcript));
  const todosLine = seg.renderTodosLine(ctx.transcript);
  if (todosLine) lines.push(todosLine);

  // Output lines directly to avoid formatting surprises across terminals/renderers.
  for (const line of lines) console.log(line);
}

/**
 * Compact mode - exactly 2 lines: session info + location
 */
function renderCompact(ctx) {
  const sep = seg.SEP();
  console.log([
    seg.modelSegment(ctx),
    seg.effortSegment(ctx, false),
    seg.contextSegment(ctx, 8),
    seg.limitSegment('5h', ctx.fiveHour, false)
  ].filter(Boolean).join(sep));
  console.log([seg.dirSegment(ctx, 50), seg.gitSegment(ctx)].filter(Boolean).join(sep));
}

/**
 * Minimal mode - single line, no bars
 */
function renderMinimal(ctx) {
  const sep = seg.SEP();
  const ctxText = ctx.contextSize > 0 ? `${ctx.contextPercent}% ctx` : '';
  console.log([
    seg.modelSegment(ctx),
    seg.effortSegment(ctx, false),
    ctxText,
    seg.limitSegment('5h', ctx.fiveHour, false),
    seg.gitSegment(ctx, false),
    seg.dirSegment(ctx, 40)
  ].filter(Boolean).join(sep));
}

// ============================================================================
// MAIN
// ============================================================================

/**
 * Session id goes into temp file names - accept only plain id characters
 */
function isSafeSessionId(sessionId) {
  return typeof sessionId === 'string' && /^[\w-]+$/.test(sessionId);
}

/**
 * Read active plan slug from the rig session temp file
 */
function readActivePlan(sessionId) {
  if (!isSafeSessionId(sessionId)) return '';
  try {
    const sessionPath = path.join(os.tmpdir(), `rig-session-${sessionId}.json`);
    if (!fs.existsSync(sessionPath)) return '';
    const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    const planPath = session.activePlan?.trim().replace(/\\/g, '/');
    if (!planPath) return '';
    // Extract slug from path like "plans/260106-1554-statusline-visual"
    const match = planPath.match(/plans\/\d+-\d+-(.+?)(?:\/|$)/);
    return match ? match[1] : planPath.split('/').pop();
  } catch {
    return '';
  }
}

async function main() {
  try {
    const input = await readStdin();
    if (!input.trim()) {
      console.error('No input provided');
      process.exit(1);
    }

    const data = JSON.parse(input);
    const rawDir = data.workspace?.current_dir || data.cwd || process.cwd();
    const currentDir = expandHome(data.workspace?.current_dir || data.cwd || 'unknown');
    const sessionId = data.session_id;

    // Context window - prefer pre-calculated fields, fallback to manual calculation
    const usage = data.context_window?.current_usage || {};
    const contextSize = data.context_window?.context_window_size || 0;
    let contextPercent = 0;
    let totalTokens = 0;

    if (contextSize > 0) {
      totalTokens = (usage.input_tokens ?? 0) +
                    (usage.cache_creation_input_tokens ?? 0) +
                    (usage.cache_read_input_tokens ?? 0);

      // Use pre-calculated percentage from Claude Code (model-agnostic, works for 200K and 1M)
      const preCalcPercent = data.context_window?.used_percentage;
      if (typeof preCalcPercent === 'number' && preCalcPercent >= 0) {
        contextPercent = Math.round(preCalcPercent);
      } else if (contextSize > AUTOCOMPACT_BUFFER) {
        // Fallback: manual calculation with buffer
        contextPercent = Math.min(100, Math.round(((totalTokens + AUTOCOMPACT_BUFFER) / contextSize) * 100));
      }
    }

    // Write context data to temp file for hooks to read
    if (isSafeSessionId(sessionId) && contextSize > 0) {
      try {
        const contextDataPath = path.join(os.tmpdir(), `rig-context-${sessionId}.json`);
        fs.writeFileSync(contextDataPath, JSON.stringify({
          percent: contextPercent,
          remaining: data.context_window?.remaining_percentage ?? (100 - contextPercent),
          tokens: totalTokens,
          size: contextSize,
          usage: usage,
          timestamp: Date.now()
        }));
      } catch {}
    }

    // Parse transcript for tools/agents/todos
    const transcript = data.transcript_path
      ? await parseTranscript(data.transcript_path)
      : { tools: [], agents: [], todos: [], sessionStart: null };

    // Cost: hidden for subscription users (rate_limits present) unless billing mode is explicitly api
    const billingMode = (env.CLAUDE_BILLING_MODE || (data.rate_limits ? 'subscription' : 'api')).toLowerCase();
    const costUSD = data.cost?.total_cost_usd;
    const costText = billingMode === 'api' && costUSD && /^\d+(\.\d+)?$/.test(String(costUSD))
      ? `$${parseFloat(costUSD).toFixed(parseFloat(costUSD) < 1 ? 3 : 2)}`
      : null;

    const ctx = {
      modelName: data.model?.display_name || 'Claude',
      agentName: data.agent?.name || '',
      // Live session effort (reflects /effort); absent when the model has no effort support
      effortLevel: data.effort?.level || '',
      version: data.version || '',
      outputStyle: data.output_style?.name || '',
      vimMode: data.vim?.mode || '',
      currentDir,
      git: getGitInfo(rawDir),
      activePlan: readActivePlan(sessionId),
      contextPercent,
      contextTokens: totalTokens,
      contextSize,
      fiveHour: parseLimitWindow(data.rate_limits?.five_hour),
      sevenDay: parseLimitWindow(data.rate_limits?.seven_day),
      costText,
      durationMs: data.cost?.total_duration_ms || 0,
      apiDurationMs: data.cost?.total_api_duration_ms || 0,
      inputTokens: data.context_window?.total_input_tokens || 0,
      outputTokens: data.context_window?.total_output_tokens || 0,
      linesAdded: data.cost?.total_lines_added || 0,
      linesRemoved: data.cost?.total_lines_removed || 0,
      configs: countConfigs(rawDir),
      transcript
    };

    // Load config and get statusline mode
    const config = loadConfig({ includeProject: false, includeAssertions: false, includeLocale: false });
    const statuslineMode = config.statusline || 'full';

    // Apply statuslineColors config: explicit false disables colors regardless of FORCE_COLOR
    // NO_COLOR env var is checked inside isColorEnabled() and always wins
    if (config.statuslineColors === false) {
      setColorEnabled(false);
    }

    switch (statuslineMode) {
      case 'none':
        console.log('');
        break;
      case 'minimal':
        renderMinimal(ctx);
        break;
      case 'compact':
        renderCompact(ctx);
        break;
      case 'full':
      default:
        renderFull(ctx);
        break;
    }
  } catch (err) {
    // Fallback: output minimal single line on any error
    console.log('📁 ' + (process.cwd() || 'unknown'));
  }
}

main().catch(() => {
  console.log('📁 error');
  process.exit(1);
});
