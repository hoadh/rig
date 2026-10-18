#!/usr/bin/env node
'use strict';

/**
 * Statusline Scenario Suite
 *
 * Focus:
 * - Cross-platform path handling (Linux/macOS/Windows/WSL-like paths)
 * - User-facing configuration modes (none/minimal/compact/full)
 * - Slow stdin / timeout behavior
 * - Rate limit (stdin rate_limits) handling
 * - Native Task API transcript flows
 * - Terminal width layout behavior
 *
 * Run:
 *   node .claude/hooks/lib/__tests__/statusline-scenarios.test.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const TEST_ROOT = path.resolve(__dirname, '../../../..');
const STATUSLINE_PATH = path.resolve(__dirname, '../../..', 'statusline.cjs');

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${error.message}`);
    failed++;
    failures.push({ name, error: error.message });
  }
}

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertContains(actual, expected, message) {
  if (!actual.includes(expected)) {
    throw new Error(
      `${message || 'Missing expected string'}\nExpected: ${expected}\nActual: ${actual}`
    );
  }
}

function assertMatch(actual, pattern, message) {
  if (!pattern.test(actual)) {
    throw new Error(
      `${message || 'Pattern did not match'}\nPattern: ${pattern}\nActual: ${actual}`
    );
  }
}

function assertLineCountBetween(output, min, max, message) {
  const lineCount = output.replace(/\n+$/, '').split('\n').length;
  if (lineCount < min || lineCount > max) {
    throw new Error(
      `${message || 'Line count mismatch'}\nExpected: ${min}-${max}\nActual: ${lineCount}\nOutput:\n${output}`
    );
  }
}

function assertSuccessfulRun(result, messagePrefix) {
  assertTrue(result.status === 0, `${messagePrefix || 'Statusline run'} should exit with status 0`);
  assertTrue(
    (result.stderr || '').trim() === '',
    `${messagePrefix || 'Statusline run'} should not write stderr${result.stderr ? `\nStderr: ${result.stderr}` : ''}`
  );
}

function runStatuslineSync({ payload, cwd = TEST_ROOT, env = {}, inputRaw = null, timeoutMs = 20000 }) {
  const input = inputRaw == null ? JSON.stringify(payload || {}) : inputRaw;
  const result = spawnSync('node', [STATUSLINE_PATH], {
    cwd,
    encoding: 'utf8',
    input,
    timeout: timeoutMs,
    env: { ...process.env, ...env }
  });
  if (result.error) {
    throw result.error;
  }
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function runStatuslineWithDelayedChunks({ chunks, delaysMs, cwd = TEST_ROOT, env = {}, timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [STATUSLINE_PATH], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    const killTimer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(killTimer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(killTimer);
      resolve({ status: code, stdout, stderr });
    });

    let i = 0;
    const writeNext = () => {
      if (i >= chunks.length) {
        child.stdin.end();
        return;
      }
      child.stdin.write(chunks[i]);
      const delay = delaysMs[i] || 0;
      i++;
      setTimeout(writeNext, delay);
    };
    writeNext();
  });
}

function createTempConfigProject(mode) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `statusline-mode-${mode}-`));
  const rigDir = path.join(tmpDir, '.claude');
  fs.mkdirSync(rigDir, { recursive: true });
  fs.writeFileSync(
    path.join(rigDir, '.rig.json'),
    JSON.stringify({ statusline: mode }, null, 2)
  );
  return tmpDir;
}

function mkTranscript(lines) {
  const p = path.join(os.tmpdir(), `statusline-scenario-transcript-${Date.now()}-${Math.random().toString(16).slice(2)}.jsonl`);
  fs.writeFileSync(p, lines.map((line) => JSON.stringify(line)).join('\n'));
  return p;
}

async function main() {
  console.log('\n==============================================');
  console.log('STATUSLINE SCENARIO SUITE');
  console.log('==============================================\n');

  await test('Linux/macOS path output works', async () => {
    const payload = {
      model: { display_name: 'Claude' },
      workspace: { current_dir: '/home/user/project' },
      context_window: { context_window_size: 200000 }
    };
    const result = runStatuslineSync({ payload });
    assertSuccessfulRun(result, 'Linux/macOS path scenario');
    const { stdout } = result;
    assertContains(stdout, '/home/user/project', 'Should display Unix-style path');
  });

  await test('Windows drive-letter path output works', async () => {
    const payload = {
      model: { display_name: 'Claude' },
      workspace: { current_dir: 'D:\\statusline-test\\project' },
      context_window: { context_window_size: 200000 }
    };
    const result = runStatuslineSync({ payload });
    assertSuccessfulRun(result, 'Windows drive path scenario');
    const { stdout } = result;
    assertContains(stdout, 'D:\\statusline-test\\project', 'Should preserve Windows path');
  });

  await test('Windows UNC path output works', async () => {
    const payload = {
      model: { display_name: 'Claude' },
      workspace: { current_dir: '\\\\server\\share\\repo' },
      context_window: { context_window_size: 200000 }
    };
    const result = runStatuslineSync({ payload });
    assertSuccessfulRun(result, 'Windows UNC path scenario');
    const { stdout } = result;
    assertContains(stdout, '\\\\server\\share\\repo', 'Should preserve UNC path');
  });

  await test('WSL-style path output works', async () => {
    const payload = {
      model: { display_name: 'Claude' },
      workspace: { current_dir: '/mnt/c/Users/kai/project' },
      context_window: { context_window_size: 200000 }
    };
    const result = runStatuslineSync({ payload });
    assertSuccessfulRun(result, 'WSL path scenario');
    const { stdout } = result;
    assertContains(stdout, '/mnt/c/Users/kai/project', 'Should preserve WSL path');
  });

  await test('Home path is expanded to ~ for current OS homedir', async () => {
    const payload = {
      model: { display_name: 'Claude' },
      workspace: { current_dir: path.join(os.homedir(), 'projects', 'test') },
      context_window: { context_window_size: 200000 }
    };
    const result = runStatuslineSync({ payload });
    assertSuccessfulRun(result, 'Home path expansion scenario');
    const { stdout } = result;
    assertMatch(
      stdout,
      /~[\\/]projects[\\/]test/,
      'Should compress homedir prefix to ~ with platform-appropriate separators'
    );
  });

  await test('Mode none produces empty output', async () => {
    const tmpDir = createTempConfigProject('none');
    try {
      const payload = {
        model: { display_name: 'Claude' },
        workspace: { current_dir: '/tmp' },
        context_window: { context_window_size: 200000 }
      };
      const result = runStatuslineSync({ payload, cwd: tmpDir });
      assertSuccessfulRun(result, 'Mode none scenario');
      const { stdout } = result;
      assertTrue(stdout.trim() === '', 'Mode none should produce empty output');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await test('Mode minimal keeps output to one line', async () => {
    const tmpDir = createTempConfigProject('minimal');
    try {
      const payload = {
        model: { display_name: 'Claude' },
        workspace: { current_dir: '/tmp' },
        context_window: { context_window_size: 200000, current_usage: { input_tokens: 1000 } }
      };
      const result = runStatuslineSync({ payload, cwd: tmpDir });
      assertSuccessfulRun(result, 'Mode minimal scenario');
      const { stdout } = result;
      assertLineCountBetween(stdout, 1, 1, 'Minimal mode should be single-line');
      assertContains(stdout, '/tmp', 'Minimal mode should still include workspace info');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await test('Mode compact keeps output to two lines', async () => {
    const tmpDir = createTempConfigProject('compact');
    try {
      const payload = {
        model: { display_name: 'Claude' },
        workspace: { current_dir: '/tmp' },
        context_window: { context_window_size: 200000, current_usage: { input_tokens: 1000 } }
      };
      const result = runStatuslineSync({ payload, cwd: tmpDir });
      assertSuccessfulRun(result, 'Mode compact scenario');
      const { stdout } = result;
      assertLineCountBetween(stdout, 2, 2, 'Compact mode should be exactly two lines');
      assertContains(stdout, 'Claude', 'Compact mode should include model');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await test('Default/full mode includes model and path', async () => {
    const payload = {
      model: { display_name: 'Claude' },
      workspace: { current_dir: '/tmp/full-mode' },
      context_window: { context_window_size: 200000, current_usage: { input_tokens: 50000 } }
    };
    const result = runStatuslineSync({ payload });
    assertSuccessfulRun(result, 'Default/full mode scenario');
    const { stdout } = result;
    assertContains(stdout, 'Claude', 'Full mode should include model');
    assertContains(stdout, '/tmp/full-mode', 'Full mode should include directory');
  });

  await test('Default stdin handling supports slow chunked input (>5s)', async () => {
    const result = await runStatuslineWithDelayedChunks({
      chunks: [
        '{"model":{"display_name":"Claude"}',
        ',"workspace":{"current_dir":"/tmp/slow-input-ok"},"context_window":{"context_window_size":200000}}'
      ],
      delaysMs: [5500, 0]
    });
    assertTrue(result.status === 0, 'Slow chunk input should still exit successfully');
    assertTrue(result.stderr.trim() === '', 'Slow chunk input should not emit stderr');
    assertContains(result.stdout, '/tmp/slow-input-ok', 'Slow input should still parse without forced fallback');
  });

  await test('Optional stdin timeout forces fallback when enabled', async () => {
    const result = await runStatuslineWithDelayedChunks({
      chunks: [
        '{"model":{"display_name":"Claude"}',
        ',"workspace":{"current_dir":"/tmp/slow-input-timeout"},"context_window":{"context_window_size":200000}}'
      ],
      delaysMs: [400, 0],
      env: { RIG_STATUSLINE_STDIN_TIMEOUT_MS: '100' }
    });
    assertTrue(result.status === 0, 'Timeout fallback path should still exit successfully');
    assertTrue(result.stderr.trim() === '', 'Timeout fallback path should not emit stderr');
    assertContains(result.stdout, TEST_ROOT, 'Timeout path should fall back to cwd');
  });

  await test('Missing rate_limits (API key users) suppresses reset string gracefully', async () => {
    const payload = {
      model: { display_name: 'Claude' },
      workspace: { current_dir: '/tmp' },
      context_window: { context_window_size: 200000, current_usage: { input_tokens: 1000 } }
    };
    const result = runStatuslineSync({ payload });
    assertSuccessfulRun(result, 'No rate_limits scenario');
    const { stdout } = result;
    assertTrue(stdout.length > 0, 'Missing rate_limits should still render statusline');
    assertTrue(!stdout.includes('until reset') && !stdout.includes(' left'), 'Missing rate_limits should not render reset countdown text');
  });

  await test('stdin rate_limits shows reset countdown and utilization', async () => {
    const payload = {
      model: { display_name: 'Claude' },
      workspace: { current_dir: '/tmp' },
      context_window: { context_window_size: 200000, current_usage: { input_tokens: 1000 } },
      rate_limits: {
        five_hour: { used_percentage: 38.2, resets_at: Math.floor(Date.now() / 1000) + 2 * 3600 + 15 * 60 },
        seven_day: { used_percentage: 40, resets_at: Math.floor(Date.now() / 1000) + 5 * 86400 }
      }
    };
    const result = runStatuslineSync({ payload });
    assertSuccessfulRun(result, 'rate_limits scenario');
    const { stdout } = result;
    assertMatch(stdout, /2h 1[45]m/, 'Should show reset countdown from epoch-seconds resets_at');
    assertMatch(stdout, /38%/, 'Should include rounded utilization');
  });

  await test('stdin effort.level is rendered, absent effort is hidden', async () => {
    const base = {
      model: { display_name: 'Claude' },
      workspace: { current_dir: '/tmp' },
      context_window: { context_window_size: 200000, current_usage: { input_tokens: 1000 } }
    };
    const withEffort = runStatuslineSync({ payload: { ...base, effort: { level: 'xhigh' } } });
    assertSuccessfulRun(withEffort, 'Effort scenario');
    assertContains(withEffort.stdout, 'xhigh', 'Should show effort level');
    assertContains(withEffort.stdout.replace(/\x1b\[[0-9;]*m/g, ''), '▮▮▮▮▯', 'Should show effort meter for xhigh');

    const noEffort = runStatuslineSync({ payload: base });
    assertSuccessfulRun(noEffort, 'No effort scenario');
    assertTrue(!noEffort.stdout.includes('▮'), 'Missing effort should not render meter');
  });

  await test('Expired resets_at hides countdown', async () => {
    const payload = {
      model: { display_name: 'Claude' },
      workspace: { current_dir: '/tmp' },
      context_window: { context_window_size: 200000, current_usage: { input_tokens: 1000 } },
      rate_limits: { five_hour: { used_percentage: 5, resets_at: Math.floor(Date.now() / 1000) - 60 } }
    };
    const result = runStatuslineSync({ payload });
    assertSuccessfulRun(result, 'Expired rate_limits scenario');
    assertTrue(!result.stdout.includes(' left'), 'Expired reset should not render countdown');
  });

  await test('Native TaskCreate/TaskUpdate flow is rendered', async () => {
    const transcriptPath = mkTranscript([
      {
        timestamp: new Date(Date.now() - 120000).toISOString(),
        message: {
          content: [{
            type: 'tool_use',
            id: 'task-create-1',
            name: 'TaskCreate',
            input: { subject: 'Implement auth flow' }
          }]
        }
      },
      {
        timestamp: new Date(Date.now() - 110000).toISOString(),
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'task-create-1',
            is_error: false,
            content: '{"taskId":"task-001"}'
          }]
        }
      },
      {
        timestamp: new Date(Date.now() - 100000).toISOString(),
        message: {
          content: [{
            type: 'tool_use',
            id: 'task-update-1',
            name: 'TaskUpdate',
            input: {
              taskId: 'task-001',
              status: 'in_progress',
              activeForm: 'Implementing auth flow'
            }
          }]
        }
      }
    ]);

    try {
      const payload = {
        model: { display_name: 'Claude' },
        workspace: { current_dir: '/tmp/project' },
        context_window: { context_window_size: 200000, current_usage: { input_tokens: 1000 } },
        transcript_path: transcriptPath
      };
      const result = runStatuslineSync({ payload });
      assertSuccessfulRun(result, 'Native TaskCreate/TaskUpdate scenario');
      const { stdout } = result;
      assertContains(stdout, 'Implementing auth flow', 'Native task activeForm should be shown');
    } finally {
      try { fs.unlinkSync(transcriptPath); } catch {}
    }
  });

  await test('Mixed TodoWrite + Native TaskUpdate keeps legacy todo unchanged', async () => {
    const transcriptPath = mkTranscript([
      {
        timestamp: new Date(Date.now() - 120000).toISOString(),
        message: {
          content: [{
            type: 'tool_use',
            id: 'todo-write-1',
            name: 'TodoWrite',
            input: {
              todos: [
                { content: 'Legacy first', status: 'pending' },
                { content: 'Legacy second', status: 'pending' }
              ]
            }
          }]
        }
      },
      {
        timestamp: new Date(Date.now() - 110000).toISOString(),
        message: {
          content: [{
            type: 'tool_use',
            id: 'task-create-1',
            name: 'TaskCreate',
            input: { subject: 'Native first' }
          }]
        }
      },
      {
        timestamp: new Date(Date.now() - 100000).toISOString(),
        message: {
          content: [{
            type: 'tool_use',
            id: 'task-update-1',
            name: 'TaskUpdate',
            input: {
              taskId: '1',
              status: 'in_progress',
              activeForm: 'Working native first'
            }
          }]
        }
      }
    ]);

    try {
      const payload = {
        model: { display_name: 'Claude' },
        workspace: { current_dir: '/tmp/project' },
        context_window: { context_window_size: 200000, current_usage: { input_tokens: 1000 } },
        transcript_path: transcriptPath
      };
      const result = runStatuslineSync({ payload });
      assertSuccessfulRun(result, 'Mixed native/legacy transcript scenario');
      const { stdout } = result;
      assertContains(stdout, 'Working native first', 'Native fallback should map to native tasks, not legacy TodoWrite');
      assertTrue(!stdout.includes('Legacy first'), 'Legacy TodoWrite item should not be promoted to active task');
      assertTrue(!stdout.includes('Legacy second'), 'Legacy TodoWrite list should not leak into native active line');
    } finally {
      try { fs.unlinkSync(transcriptPath); } catch {}
    }
  });

  await test('Wide terminal keeps layout compact', async () => {
    const payload = {
      model: { display_name: 'Opus 4.5' },
      workspace: { current_dir: '/tmp/short' },
      context_window: { context_window_size: 200000, current_usage: { input_tokens: 50000 } },
      cost: { total_lines_added: 10, total_lines_removed: 5 }
    };
    const result = runStatuslineSync({ payload, env: { COLUMNS: '180' } });
    assertSuccessfulRun(result, 'Wide terminal scenario');
    const { stdout } = result;
    assertLineCountBetween(stdout, 1, 3, 'Wide layout should avoid excessive wrapping');
    assertContains(stdout, '/tmp/short', 'Wide layout should still include directory');
  });

  await test('Narrow terminal wraps long unicode path without crashing', async () => {
    const payload = {
      model: { display_name: 'Claude' },
      workspace: { current_dir: '/tmp/工程工程工程/e\u0301/🤖/very/long/path/segment' },
      context_window: { context_window_size: 200000, current_usage: { input_tokens: 50000 } }
    };
    const result = runStatuslineSync({ payload, env: { COLUMNS: '50' } });
    assertSuccessfulRun(result, 'Narrow terminal scenario');
    const { stdout } = result;
    assertTrue(stdout.length > 0, 'Should render output in narrow mode');
    assertTrue(stdout.split('\n').length >= 2, 'Narrow width should wrap to multiple lines');
  });

  console.log('\n==============================================');
  console.log('SCENARIO TEST SUMMARY');
  console.log('==============================================');
  console.log(`Total: ${passed + failed}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`- ${f.name}: ${f.error.split('\n')[0]}`);
    }
    process.exit(1);
  }

  console.log('\n✓ All scenario tests passed!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
