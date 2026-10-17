#!/usr/bin/env node
/**
 * Tests for dev-rules-reminder.cjs hook - output sections and path resolution
 * Run: node --test .claude/hooks/__tests__/dev-rules-reminder.test.cjs
 *
 * Paths anchor to CLAUDE_PROJECT_DIR (CWD fallback, Issue #327)
 * Key scenarios:
 * - Absolute paths in output
 * - Subdirectory workflow support
 * - Path consistency validation
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const HOOK_PATH = path.join(__dirname, '..', 'dev-rules-reminder.cjs');

/**
 * Execute dev-rules-reminder.cjs with given stdin data and return stdout
 * @param {Object} inputData - Data to pass as JSON stdin
 * @param {Object} options - Spawn options (cwd, env)
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
function runHook(inputData, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [HOOK_PATH], {
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        CLAUDE_ENV_FILE: '',
        RIG_DEBUG: options.debug ? '1' : '',
        ...options.env
      }
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    if (inputData) {
      proc.stdin.write(JSON.stringify(inputData));
    }
    proc.stdin.end();

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code });
    });

    proc.on('error', reject);

    setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('Hook execution timed out'));
    }, 10000);
  });
}

/**
 * Get git root for current directory
 */
function getGitRoot(cwd = process.cwd()) {
  try {
    return execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      cwd
    }).trim();
  } catch (e) {
    return null;
  }
}

describe('dev-rules-reminder.cjs', () => {
  const gitRoot = getGitRoot();
  // Pin the project dir so the outer Claude Code session's env cannot leak in
  const projectEnv = { CLAUDE_PROJECT_DIR: gitRoot || process.cwd() };

  describe('Basic Functionality', () => {

    it('exits with code 0 (non-blocking)', async () => {
      const result = await runHook({ user_prompt: 'test' }, { env: projectEnv });
      assert.strictEqual(result.exitCode, 0, 'Hook should exit with code 0');
    });

    it('handles empty stdin gracefully', async () => {
      const result = await runHook(null);
      assert.strictEqual(result.exitCode, 0, 'Hook should exit with code 0');
      assert.strictEqual(result.stdout, '');
    });

  });

  describe('Output Sections', () => {

    it('emits session, paths, plan context and naming only', async () => {
      const result = await runHook({ user_prompt: 'test' }, { env: projectEnv });
      for (const header of ['## Rig Session', '## Paths', '## Plan Context', '## Naming']) {
        assert.ok(result.stdout.includes(header), `Should include ${header}`);
      }
      for (const removed of ['## Rules', 'Modularization', 'YAGNI', 'Memory usage', '## Usage']) {
        assert.ok(!result.stdout.includes(removed), `Should not include ${removed}`);
      }
    });

    it('stays small (static guidance lives in rules files)', async () => {
      const result = await runHook({ user_prompt: 'test' }, { env: projectEnv });
      assert.ok(result.stdout.length < 1200, `Output is ${result.stdout.length} bytes`);
    });

  });

  describe('Path Resolution', () => {

    it('uses absolute paths under the project dir', async () => {
      if (!gitRoot) return;
      const result = await runHook({ user_prompt: 'test' }, { cwd: gitRoot, env: projectEnv });
      assert.ok(result.stdout.includes(`Reports: ${path.join(gitRoot, 'plans', 'reports')}`), result.stdout);
      assert.ok(result.stdout.includes(`Plans: ${path.join(gitRoot, 'plans')}/`), result.stdout);
    });

    it('anchors paths to CLAUDE_PROJECT_DIR when the CWD is a subdirectory', async () => {
      if (!gitRoot) return;
      const subdir = path.join(gitRoot, '.claude', 'hooks');
      const result = await runHook({ user_prompt: 'test' }, { cwd: subdir, env: projectEnv });
      assert.ok(result.stdout.includes(`Plans: ${path.join(gitRoot, 'plans')}/`), result.stdout);
      assert.ok(!result.stdout.includes(path.join(subdir, 'plans')), 'Must not resolve plans under the subdirectory');
    });

    it('never repeats the project dir inside a path', async () => {
      if (!gitRoot) return;
      const subdir = path.join(gitRoot, '.claude', 'hooks');
      const result = await runHook({ user_prompt: 'test' }, { cwd: subdir, env: projectEnv });
      const relRoot = gitRoot.replace(/^[\\/]/, '');
      assert.ok(!result.stdout.includes(path.join(gitRoot, relRoot)), result.stdout);
    });

    it('falls back to the CWD when CLAUDE_PROJECT_DIR is unset', async () => {
      const tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dev-rules-cwd-')));
      try {
        const result = await runHook({ user_prompt: 'test' }, { cwd: tempDir, env: { CLAUDE_PROJECT_DIR: '' } });
        assert.ok(result.stdout.includes(`Plans: ${path.join(tempDir, 'plans')}/`), result.stdout);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

  });

  describe('Transcript Deduplication', () => {

    function withTranscript(lines, fn) {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-rules-test-'));
      const transcriptPath = path.join(tempDir, 'transcript.jsonl');
      fs.writeFileSync(transcriptPath, lines.join('\n'));
      return fn(transcriptPath).finally(() => fs.rmSync(tempDir, { recursive: true, force: true }));
    }

    it('skips output if recently injected', async () => {
      const lines = Array(200).fill('some content');
      lines[180] = '{"content":"## Rig Session\\n- DateTime: x"}';
      await withTranscript(lines, async (transcriptPath) => {
        const result = await runHook({ user_prompt: 'test', transcript_path: transcriptPath }, { env: projectEnv });
        assert.strictEqual(result.exitCode, 0);
        assert.strictEqual(result.stdout, '', 'Should not inject again');
      });
    });

    it('outputs if marker not in recent lines', async () => {
      const lines = Array(200).fill('some content without marker');
      await withTranscript(lines, async (transcriptPath) => {
        const result = await runHook({ user_prompt: 'test', transcript_path: transcriptPath }, { env: projectEnv });
        assert.ok(result.stdout.includes('## Rig Session'), 'Should inject when no recent marker');
      });
    });

  });

  describe('Error Handling', () => {

    it('exits 0 on error (fail-open)', async () => {
      const proc = spawn('node', [HOOK_PATH], {
        cwd: process.cwd(),
        env: { ...process.env, CLAUDE_ENV_FILE: '' }
      });

      proc.stdin.write('not valid json{{{');
      proc.stdin.end();

      const exitCode = await new Promise((resolve) => {
        proc.on('close', resolve);
      });

      assert.strictEqual(exitCode, 0, 'Should exit 0 on parse error (fail-open)');
    });

    it('handles missing transcript_path gracefully', async () => {
      const result = await runHook({
        user_prompt: 'test',
        transcript_path: '/nonexistent/path/transcript.txt'
      }, { env: projectEnv });

      assert.strictEqual(result.exitCode, 0);
      assert.ok(result.stdout.includes('## Rig Session'));
    });

  });

});
