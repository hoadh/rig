#!/usr/bin/env node
'use strict';

/**
 * Statusline segment renderers - build colored segments and lines from render context
 *
 * Full layout:
 *   Row 1 (AI session): ✦ model │ context bar │ 5h/7d limits │ cost · time · tokens
 *   Row 2 (workspace):  ◆ dir │ ⎇ branch + git state │ ◎ plan │ +/- lines │ config │ version
 *   Activity rows:      tools, agent flow, todo progress (only when present)
 * Each row wraps segment-by-segment when it exceeds the terminal width.
 * @module statusline-segment-renderers
 */

const { PALETTE, fg, badge, gradientBar, heatColor } = require('./colors.cjs');
const { visibleLength, truncate, truncateMiddle, formatTokens, formatDuration, formatElapsed, safeGetTime } = require('./statusline-text-formatters.cjs');

const SEP = () => fg(' │ ', PALETTE.faint);
const DOT = () => fg(' · ', PALETTE.faint);
const muted = text => fg(text, PALETTE.muted);
const SPINNER_FRAMES = ['◐', '◓', '◑', '◒'];

// ============================================================================
// LAYOUT
// ============================================================================

/**
 * Pack segments into lines no wider than maxWidth, joined by separator.
 * A single oversized segment still gets its own line (never dropped).
 */
function wrapSegments(segments, maxWidth) {
  const parts = segments.filter(Boolean);
  const sep = SEP();
  const sepLen = visibleLength(sep);
  const lines = [];
  let current = '';
  let currentLen = 0;

  for (const part of parts) {
    const len = visibleLength(part);
    if (current && currentLen + sepLen + len > maxWidth) {
      lines.push(current);
      current = '';
      currentLen = 0;
    }
    current = current ? current + sep + part : part;
    currentLen += (currentLen ? sepLen : 0) + len;
  }
  if (current) lines.push(current);
  return lines;
}

// ============================================================================
// SESSION SEGMENTS
// ============================================================================

function modelSegment(ctx) {
  let seg = `${fg('✦', PALETTE.violet, true)}${badge(truncate(ctx.modelName, 30), 98)}`;
  if (ctx.agentName) seg += ` ${muted(`@${truncate(ctx.agentName, 16)}`)}`;
  return seg;
}

function contextSegment(ctx, barWidth = 10) {
  if (!(ctx.contextSize > 0)) return '';
  const pct = ctx.contextPercent;
  let seg = `${gradientBar(pct, barWidth)} ${fg(`${pct}%`, heatColor(pct), true)}`;
  if (ctx.contextTokens > 0) {
    seg += ` ${muted(`${formatTokens(ctx.contextTokens)}/${formatTokens(ctx.contextSize)}`)}`;
  }
  return seg;
}

/**
 * One rate-limit window: "5h ━━━─── 38% ↻ 2h 15m"
 */
function limitSegment(label, limit, withBar) {
  if (!limit || (limit.percent == null && !limit.resetSec)) return '';
  let seg = fg(label, PALETTE.cyan, true);
  if (limit.percent != null) {
    const pct = Math.round(limit.percent);
    if (withBar) seg += ` ${gradientBar(pct, 6)}`;
    seg += ` ${fg(`${pct}%`, heatColor(pct))}`;
  }
  if (limit.resetSec > 0) seg += ` ${muted(`↻ ${formatDuration(limit.resetSec * 1000)}`)}`;
  return seg;
}

function metricsSegment(ctx) {
  const items = [];
  if (ctx.costText) items.push(fg(ctx.costText, PALETTE.yellow));
  if (ctx.durationMs > 0) {
    let time = `${fg('◷', PALETTE.blue)} ${formatDuration(ctx.durationMs)}`;
    if (ctx.apiDurationMs > 0) time += muted(` api ${formatDuration(ctx.apiDurationMs)}`);
    items.push(time);
  }
  if (ctx.inputTokens > 0 || ctx.outputTokens > 0) {
    items.push(`${fg('◇', PALETTE.teal)} ${formatTokens(ctx.inputTokens)}${muted(' in')} ${formatTokens(ctx.outputTokens)}${muted(' out')}`);
  }
  return items.join(DOT());
}

// ============================================================================
// WORKSPACE SEGMENTS
// ============================================================================

function dirSegment(ctx, maxLen = Infinity) {
  return `${fg('◆', PALETTE.blue)} ${fg(truncateMiddle(ctx.currentDir, maxLen), PALETTE.text, true)}`;
}

function gitSegment(ctx, withState = true) {
  const git = ctx.git;
  if (!git || !git.branch) return '';
  let seg = `${fg('⎇', PALETTE.purple)} ${fg(truncate(git.branch, 40), PALETTE.purple, true)}`;
  if (!withState) return seg;

  const state = [];
  if (git.staged > 0) state.push(fg(`+${git.staged}`, PALETTE.green));
  if (git.unstaged > 0) state.push(fg(`~${git.unstaged}`, PALETTE.yellow));
  if (git.ahead > 0) state.push(fg(`⇡${git.ahead}`, PALETTE.cyan));
  if (git.behind > 0) state.push(fg(`⇣${git.behind}`, PALETTE.orange));
  seg += ' ' + (state.length ? state.join(' ') : fg('✓', PALETTE.green));
  return seg;
}

function changesSegment(ctx) {
  if (!(ctx.linesAdded > 0 || ctx.linesRemoved > 0)) return '';
  return `${fg(`+${ctx.linesAdded}`, PALETTE.green)} ${fg(`-${ctx.linesRemoved}`, PALETTE.red)}`;
}

function configSegment(ctx) {
  const c = ctx.configs;
  if (!c) return '';
  const items = [
    [c.claudeMdCount, 'md'],
    [c.rulesCount, 'rules'],
    [c.mcpCount, 'mcp'],
    [c.hooksCount, 'hooks']
  ].filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`);
  return items.length ? muted(`≡ ${items.join(' · ')}`) : '';
}

function envSegment(ctx) {
  const items = [];
  if (ctx.vimMode) items.push(fg(`[${ctx.vimMode}]`, PALETTE.pink, true));
  if (ctx.outputStyle && ctx.outputStyle !== 'default') items.push(fg(`style:${ctx.outputStyle}`, PALETTE.pink));
  if (ctx.version) items.push(muted(`v${ctx.version}`));
  return items.join(' ');
}

// ============================================================================
// ACTIVITY LINES (tools, agents, todos)
// ============================================================================

function renderToolsLine(transcript) {
  const tools = transcript?.tools || [];
  if (tools.length === 0) return null;

  const running = tools.filter(t => t.status === 'running');
  if (running.length > 0) {
    const tool = running[running.length - 1];
    const frame = SPINNER_FRAMES[Math.floor(Date.now() / 500) % SPINNER_FRAMES.length];
    let line = `${fg(frame, PALETTE.yellow)} ${fg(tool.name, PALETTE.yellow, true)}`;
    if (tool.target) line += ` ${muted(truncate(tool.target, 48))}`;
    line += ` ${muted(formatElapsed(tool.startTime))}`;
    if (running.length > 1) line += ` ${muted(`+${running.length - 1} more`)}`;
    return line;
  }

  // Summary of recent tool usage, most used first
  const counts = new Map();
  let errors = 0;
  for (const tool of tools) {
    counts.set(tool.name, (counts.get(tool.name) || 0) + 1);
    if (tool.status === 'error') errors++;
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([name, n]) => `${name}${muted(`×${n}`)}`);
  let line = `${muted('tools')} ${top.join(' ')}`;
  if (errors > 0) line += ` ${fg(`✗${errors}`, PALETTE.red)}`;
  return line;
}

/**
 * Agents as compact chronological flow with duplicate collapsing
 * Format: ○ type ×N → ● type (N done)
 *            ▸ description (elapsed)
 */
function renderAgentsLines(transcript) {
  const agents = transcript?.agents || [];
  if (agents.length === 0) return [];

  const sorted = [...agents].sort((a, b) => safeGetTime(a.startTime) - safeGetTime(b.startTime));

  // Collapse consecutive duplicate types before slicing
  const collapsed = [];
  for (const agent of sorted) {
    const type = agent.type || 'agent';
    const last = collapsed[collapsed.length - 1];
    if (last && last.type === type && last.status === agent.status) {
      last.count++;
    } else {
      collapsed.push({ type, status: agent.status, count: 1 });
    }
  }

  const flow = collapsed.slice(-4).map(group => {
    const isRunning = group.status === 'running';
    const icon = isRunning ? fg('●', PALETTE.yellow) : fg('○', PALETTE.muted);
    const name = isRunning ? fg(group.type, PALETTE.text, true) : muted(group.type);
    return `${icon} ${name}${group.count > 1 ? muted(` ×${group.count}`) : ''}`;
  });

  const completed = agents.filter(a => a.status === 'completed');
  const running = agents.filter(a => a.status === 'running');
  let flowLine = `${fg('⬡', PALETTE.violet)} ${flow.join(fg(' → ', PALETTE.faint))}`;
  if (running.length > 0) flowLine += ` ${fg(`${running.length} running`, PALETTE.yellow)}`;
  if (completed.length > 0) flowLine += ` ${muted(`${completed.length} done`)}`;

  const lines = [flowLine];
  const detail = running[0] || completed[completed.length - 1];
  if (detail && detail.description) {
    const icon = detail.status === 'running' ? fg('▸', PALETTE.yellow) : muted('▸');
    const model = detail.model ? muted(` [${detail.model}]`) : '';
    lines.push(`   ${icon} ${truncate(detail.description, 50)}${model} ${muted(`(${formatElapsed(detail.startTime, detail.endTime)})`)}`);
  }
  return lines;
}

/**
 * Todo progress: current task + progress bar + done/total
 */
function renderTodosLine(transcript) {
  const todos = transcript?.todos || [];
  if (todos.length === 0) return null;

  const total = todos.length;
  const done = todos.filter(t => t.status === 'completed').length;
  const pending = todos.filter(t => t.status === 'pending').length;
  const progress = `${gradientBar(Math.round((done / total) * 100), 8, PALETTE.green)} ${muted(`${done}/${total}`)}`;
  const inProgress = todos.find(t => t.status === 'in_progress');

  if (inProgress) {
    const text = truncate(inProgress.activeForm || inProgress.content, 50);
    return `${fg('▸', PALETTE.yellow)} ${fg(text, PALETTE.text, true)}  ${progress}`;
  }
  if (done === total) return `${fg('✓', PALETTE.green)} All ${total} todos complete`;
  if (pending > 0) {
    const next = todos.find(t => t.status === 'pending');
    return `${muted('○')} Next: ${truncate(next?.content || 'Next task', 40)}  ${progress}`;
  }
  return null;
}

module.exports = {
  wrapSegments,
  modelSegment,
  contextSegment,
  limitSegment,
  metricsSegment,
  dirSegment,
  gitSegment,
  changesSegment,
  configSegment,
  envSegment,
  renderToolsLine,
  renderAgentsLines,
  renderTodosLine,
  SEP
};
