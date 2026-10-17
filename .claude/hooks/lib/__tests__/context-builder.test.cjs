#!/usr/bin/env node
/**
 * Tests for context-builder.cjs - the per-prompt reminder
 * Run: node --test .claude/hooks/lib/__tests__/context-builder.test.cjs
 *
 * Key scenarios:
 * - Only dynamic sections are emitted (no static rules/usage/modularization text)
 * - Absolute paths never get the base dir prepended twice
 * - Thinking language shows only when configured
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const contextBuilder = require('../context-builder.cjs');

const BASE_CONFIG = {
  plan: { namingFormat: '{date}-{slug}', dateFormat: 'YYMMDD', reportsDir: 'reports', validation: {} },
  paths: { plans: 'plans', docs: 'docs' },
  docs: { maxLoc: 800 },
  locale: {}
};

describe('context-builder.cjs', () => {
  // resolveSkillsVenv() also looks in ~/.claude/. Point HOME at an empty dir so a global
  // Rig install on the test machine cannot change the results.
  const originalHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  const originalCwd = process.cwd();
  let fakeHome;
  let projectDir;

  before(() => {
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'context-builder-home-'));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-builder-project-'));
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    process.chdir(projectDir);
  });

  after(() => {
    process.chdir(originalCwd);
    process.env.HOME = originalHome.HOME;
    if (originalHome.USERPROFILE === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalHome.USERPROFILE;
    fs.rmSync(fakeHome, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  describe('buildReminderContext()', () => {

    it('emits only the dynamic sections, in order', () => {
      const { content, sections } = contextBuilder.buildReminderContext({ config: BASE_CONFIG, baseDir: projectDir });
      assert.deepStrictEqual(Object.keys(sections), ['session', 'paths', 'planContext', 'naming']);
      assert.ok(content.startsWith(contextBuilder.REMINDER_MARKER), 'Marker must be the first line');
      for (const removed of ['Modularization', 'YAGNI', '## Rules', '## Usage', 'Memory usage', 'CPU usage']) {
        assert.ok(!content.includes(removed), `Should not include "${removed}"`);
      }
    });

    it('makes paths absolute against baseDir', () => {
      const { content } = contextBuilder.buildReminderContext({ config: BASE_CONFIG, baseDir: projectDir });
      assert.ok(content.includes(`Reports: ${path.join(projectDir, 'plans', 'reports')}${path.sep}`));
      assert.ok(content.includes(`Plans: ${path.join(projectDir, 'plans')}/`));
      assert.ok(content.includes(`Docs: ${path.join(projectDir, 'docs')}/`));
    });

    it('keeps relative paths when no baseDir is given', () => {
      const { content } = contextBuilder.buildReminderContext({ config: BASE_CONFIG });
      assert.ok(content.includes('Reports: plans/reports/ | Plans: plans/ | Docs: docs/'));
    });

    it('does not double an absolute plans path', () => {
      const absPlans = path.join(projectDir, 'elsewhere', 'plans');
      const config = { ...BASE_CONFIG, paths: { plans: absPlans, docs: 'docs' } };
      const { content } = contextBuilder.buildReminderContext({ config, baseDir: projectDir });
      assert.ok(content.includes(`Plans: ${absPlans}/`), content);
      assert.ok(!content.includes(projectDir + projectDir), 'Base dir must not appear twice in a row');
    });

    it('shows thinking language only when configured', () => {
      const without = contextBuilder.buildReminderContext({ config: BASE_CONFIG }).content;
      assert.ok(!without.includes('Thinking language'));
      const config = { ...BASE_CONFIG, locale: { thinkingLanguage: 'en', responseLanguage: 'vi' } };
      const withLang = contextBuilder.buildReminderContext({ config }).content;
      assert.ok(withLang.includes('- Thinking language: en'));
      assert.ok(!withLang.includes('Respond in'), 'Response language is left to the native setting');
    });

    it('uses docs.maxLoc from config', () => {
      const config = { ...BASE_CONFIG, docs: { maxLoc: 300 } };
      assert.ok(contextBuilder.buildReminderContext({ config }).content.includes('docs.maxLoc: 300'));
    });

  });

  describe('toAbsolute()', () => {

    it('joins relative paths and keeps a trailing separator', () => {
      assert.strictEqual(contextBuilder.toAbsolute('/base', 'plans/reports/'), path.resolve('/base', 'plans/reports') + path.sep);
      assert.strictEqual(contextBuilder.toAbsolute('/base', 'plans'), path.resolve('/base', 'plans'));
    });

    it('leaves absolute paths alone', () => {
      const abs = path.resolve('/base/plans/x/reports');
      assert.strictEqual(contextBuilder.toAbsolute('/base', abs), abs);
    });

    it('returns the input when baseDir is empty', () => {
      assert.strictEqual(contextBuilder.toAbsolute(null, 'plans'), 'plans');
    });

  });

  describe('resolveSkillsVenv()', () => {

    it('returns null when no venv exists', () => {
      assert.strictEqual(contextBuilder.resolveSkillsVenv(), null);
    });

    it('prefers the project venv', () => {
      const isWindows = process.platform === 'win32';
      const bin = path.join(projectDir, '.claude', 'skills', '.venv', isWindows ? 'Scripts' : 'bin');
      fs.mkdirSync(bin, { recursive: true });
      fs.writeFileSync(path.join(bin, isWindows ? 'python.exe' : 'python3'), '');
      try {
        assert.ok(contextBuilder.resolveSkillsVenv().startsWith('.claude'));
      } finally {
        fs.rmSync(path.join(projectDir, '.claude'), { recursive: true, force: true });
      }
    });

  });

  describe('wasRecentlyInjected()', () => {

    function withTranscript(lines, fn) {
      const file = path.join(projectDir, 'transcript.jsonl');
      fs.writeFileSync(file, lines.join('\n'));
      try { fn(file); } finally { fs.rmSync(file, { force: true }); }
    }

    it('detects the marker in the last 150 lines', () => {
      const lines = Array(200).fill('x');
      lines[180] = `{"content":"${contextBuilder.REMINDER_MARKER}\\n- DateTime"}`;
      withTranscript(lines, file => assert.strictEqual(contextBuilder.wasRecentlyInjected(file), true));
    });

    it('ignores a marker older than 150 lines', () => {
      const lines = Array(200).fill('x');
      lines[10] = contextBuilder.REMINDER_MARKER;
      withTranscript(lines, file => assert.strictEqual(contextBuilder.wasRecentlyInjected(file), false));
    });

    it('returns false for a missing transcript', () => {
      assert.strictEqual(contextBuilder.wasRecentlyInjected('/nonexistent/transcript.jsonl'), false);
      assert.strictEqual(contextBuilder.wasRecentlyInjected(undefined), false);
    });

  });

});
