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
        // Isolate from the live session: an inherited RIG_SESSION_ID makes the
        // hook read the developer's active plan from /tmp/rig-session-*.json.
        RIG_SESSION_ID: '',
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

const NOW_LINE = /^- Now: \d{6}-\d{4} \(.+\)$/;
/** True when stdout is exactly the one-line Now stamp (no block). */
const isNowOnly = (stdout) => NOW_LINE.test(stdout.trim()) && !stdout.includes('##');

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

    it('emits session, plan context and naming only (paths moved to session-init)', async () => {
      const result = await runHook({ user_prompt: 'test' }, { env: projectEnv });
      for (const header of ['## Rig Session', '## Plan Context', '## Naming']) {
        assert.ok(result.stdout.includes(header), `Should include ${header}`);
      }
      for (const removed of ['## Paths', '## Rules', 'Modularization', 'YAGNI', 'Memory usage', '## Usage']) {
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
      assert.ok(result.stdout.includes(`Report: \`${path.join(gitRoot, 'plans', 'reports')}`), result.stdout);
      assert.ok(result.stdout.includes(`Plan dir: \`${path.join(gitRoot, 'plans')}/`), result.stdout);
    });

    it('anchors paths to CLAUDE_PROJECT_DIR when the CWD is a subdirectory', async () => {
      if (!gitRoot) return;
      const subdir = path.join(gitRoot, '.claude', 'hooks');
      const result = await runHook({ user_prompt: 'test' }, { cwd: subdir, env: projectEnv });
      assert.ok(result.stdout.includes(`Plan dir: \`${path.join(gitRoot, 'plans')}/`), result.stdout);
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
        assert.ok(result.stdout.includes(`Plan dir: \`${path.join(tempDir, 'plans')}/`), result.stdout);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

  });

  describe('Delta mode (emit only on plan/branch change)', () => {

    const { getReminderStatePath } = require('../lib/context-builder.cjs');
    const sessionId = `delta-test-${process.pid}-${Date.now()}`;
    const statePath = getReminderStatePath(sessionId);
    const sessionStatePath = path.join(os.tmpdir(), `rig-session-${sessionId}.json`);
    const cleanup = () => {
      for (const f of [statePath, sessionStatePath]) fs.rmSync(f, { force: true });
    };

    /** Temp git repo on `branch`, optionally with a plans dir, to vary the branch signature. */
    function makeRepo(branch) {
      const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dev-rules-delta-')));
      execSync(`git init -q -b ${branch}`, { cwd: dir });
      return dir;
    }

    it('emits on the first prompt, then stays silent while nothing changed', async () => {
      cleanup();
      const dir = makeRepo('main');
      try {
        const env = { CLAUDE_PROJECT_DIR: dir };
        const first = await runHook({ session_id: sessionId }, { cwd: dir, env });
        assert.ok(first.stdout.includes('## Rig Session'), 'first prompt emits');
        const second = await runHook({ session_id: sessionId }, { cwd: dir, env });
        assert.ok(isNowOnly(second.stdout), `unchanged context emits only the Now line: ${second.stdout}`);
        const third = await runHook({ session_id: sessionId }, { cwd: dir, env });
        assert.ok(isNowOnly(third.stdout));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        cleanup();
      }
    });

    it('emits again when the git branch changes', async () => {
      cleanup();
      const dir = makeRepo('main');
      try {
        const env = { CLAUDE_PROJECT_DIR: dir };
        await runHook({ session_id: sessionId }, { cwd: dir, env });
        execSync('git checkout -q -b feat/other', { cwd: dir });
        const after = await runHook({ session_id: sessionId }, { cwd: dir, env });
        assert.ok(after.stdout.includes('Branch: feat/other'), after.stdout);
        const again = await runHook({ session_id: sessionId }, { cwd: dir, env });
        assert.ok(isNowOnly(again.stdout), 'Now line only after the changed context was emitted');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        cleanup();
      }
    });

    it('emits again when a plan is activated for the session', async () => {
      cleanup();
      const dir = makeRepo('main');
      try {
        const env = { CLAUDE_PROJECT_DIR: dir };
        await runHook({ session_id: sessionId }, { cwd: dir, env });
        const planDir = path.join(dir, 'plans', '261106-0900-demo');
        fs.mkdirSync(planDir, { recursive: true });
        fs.writeFileSync(sessionStatePath, JSON.stringify({ sessionOrigin: dir, activePlan: planDir }));
        const after = await runHook({ session_id: sessionId }, { cwd: dir, env });
        assert.ok(after.stdout.includes(`- Plan: ${planDir}`), after.stdout);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        cleanup();
      }
    });

    it('session start clears the state so the next prompt emits again', async () => {
      cleanup();
      const dir = makeRepo('main');
      try {
        const env = { CLAUDE_PROJECT_DIR: dir };
        await runHook({ session_id: sessionId }, { cwd: dir, env });
        assert.ok(fs.existsSync(statePath), 'state written on emit');
        require('../lib/context-builder.cjs').clearReminderState(sessionId);
        const after = await runHook({ session_id: sessionId }, { cwd: dir, env });
        assert.ok(after.stdout.includes('## Rig Session'));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        cleanup();
      }
    });

    it('Naming keeps a {now} placeholder instead of a baked timestamp', async () => {
      const dir = makeRepo('main');
      try {
        const result = await runHook({ user_prompt: 'x' }, { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } });
        assert.ok(result.stdout.includes('{now}-{slug}'), result.stdout);
        assert.ok(!/\d{6}-\d{4}-\{slug\}/.test(result.stdout), 'no baked stamp in Naming');
        assert.ok(/^- Now: \d{6}-\d{4}/m.test(result.stdout), 'Now line carries the live stamp');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('writes the state file with mode 0600 and replaces a planted symlink', async () => {
      cleanup();
      const dir = makeRepo('main');
      const victim = path.join(dir, 'victim.txt');
      fs.writeFileSync(victim, 'keep');
      try {
        if (process.platform !== 'win32') fs.symlinkSync(victim, statePath);
        await runHook({ session_id: sessionId }, { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } });
        assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'keep', 'symlink target untouched');
        assert.ok(!fs.lstatSync(statePath).isSymbolicLink(), 'symlink replaced by a regular file');
        if (process.platform !== 'win32') assert.strictEqual(fs.statSync(statePath).mode & 0o777, 0o600);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        cleanup();
      }
    });

    it('always emits when there is no session id (cannot track changes)', async () => {
      const dir = makeRepo('main');
      try {
        const env = { CLAUDE_PROJECT_DIR: dir };
        const one = await runHook({ user_prompt: 'x' }, { cwd: dir, env });
        const two = await runHook({ user_prompt: 'x' }, { cwd: dir, env });
        assert.ok(one.stdout.includes('## Rig Session') && two.stdout.includes('## Rig Session'));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
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
        assert.ok(isNowOnly(result.stdout), 'Should not inject the block again, only the Now line');
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
