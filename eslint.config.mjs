// ESLint 10 flat config. `npm run lint` fails on any error; keep warnings at zero.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.agent/**', // generated mirror of .claude/ (see sync-antigravity-agent-dir.cjs)
      '**/node_modules/**',
      '**/.venv/**',
      '**/worktrees/**',
      'plans/**',
      '.claude/skills/ui-design/data/**', // vendored data
      '.claude/skills/**/assets/**', // vendored browser assets
      '**/dist/**', // compiled output (mcp skill)
    ],
  },
  js.configs.recommended,
  {
    rules: {
      // Hooks and scripts are fail-open by design: best-effort `catch {}` is deliberate.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // `_`-prefixed names mark intentionally unused values; unused catch bindings are harmless.
      'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { sourceType: 'module', globals: { ...globals.node } },
  },
  {
    // Jest-style suites in sequential-thinking use CommonJS plus jest globals
    files: ['.claude/skills/sequential-thinking/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.jest } },
  },
  {
    // Puppeteer scripts pass callbacks to page.evaluate(), which run in the browser (document, window)
    files: ['.claude/skills/browser/scripts/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // markdown-viewer suites get describe/it from tests/test-framework.cjs (run via tests/run-tests.cjs)
    files: ['.claude/skills/markdown-viewer/tests/*.test.cjs'],
    languageOptions: { globals: { ...globals.node, describe: 'readonly', it: 'readonly', before: 'readonly', after: 'readonly' } },
  },
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    // MCP protocol payloads and tool schemas are arbitrary JSON; `any` is the honest type here.
    files: ['.claude/skills/mcp/scripts/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
