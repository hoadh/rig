'use strict';
/**
 * Pure: builds the task.md prompt a worker agent receives (sent on stdin to
 * `claude -p`). Contains the phase body (frontmatter stripped), hard rules and
 * the self-review step; the final status block is informational only - the
 * orchestrator gate never trusts it.
 */

const { coordBranch } = require('./rig-branch-and-path-names.cjs');

const FM_RE = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
const stripFrontmatter = (text) => String(text).replace(FM_RE, '').trim();

/**
 * @param {{slug:string, phase:string, machine:string, branch:string, baseSha:string,
 *   owns:string[], phaseText:string, testHint?:string}} p
 */
function composeTask({ slug, phase, machine, branch, baseSha, owns, phaseText, testHint }) {
  return [
    `# Task: plan ${slug}, phase ${phase} on machine ${machine}`,
    '',
    `- Branch \`${branch}\` is already checked out in this repository. Base commit: \`${baseSha}\`.`,
    `- Full plan (read-only context): \`git show origin/${coordBranch(slug)}:plan.md\``,
    '',
    '## Rules',
    `- Edit ONLY paths matching these globs: ${owns.map((g) => `\`${g}\``).join(', ')}.`,
    '- Changes to CI/hook/agent-config paths (.github, .claude, .husky, ...) are rejected unless explicitly owned; a violation fails the whole run and nothing is pushed.',
    '- Commit with conventional commit messages (feat:, fix:, test:, refactor:).',
    '- Do NOT push, switch branches, change git config/remotes, or touch `.git`. The runner pushes for you.',
    '- Shell is limited to `git add|commit|status|diff|log|show` and the test command; nobody can answer permission prompts in this run, so anything else is denied. Create/edit files with Write/Edit; find/read with Glob/Grep/Read.',
    '- Run each shell command alone from the repository root. Do: `git add <path>`. Do not: `git -C <dir>`, `cd ... &&`, pipes, redirects. Keep commit messages plain text (single `-m`).',
    '',
    '## Steps',
    '1. Implement the phase below.',
    `2. Run the machine's tests until 100% pass${testHint ? ` (allowed test command prefixes: \`${testHint}\`; arguments may follow)` : ''}. Never skip, disable, or fake tests.`,
    `3. Self-review: read \`git diff ${baseSha}...HEAD\` for correctness, security issues and \`owns\` violations; fix what you find.`,
    '4. Commit all work (`git add`, `git commit`).',
    '',
    '## Phase',
    '',
    stripFrontmatter(phaseText),
    '',
    '## Final status block',
    'End your last message with a short block (informational only):',
    '```',
    'STATUS: done | blocked',
    'TESTS: <pass/fail counts>',
    'NOTES: <anything the reviewer must know>',
    '```',
    '',
  ].join('\n');
}

module.exports = { composeTask, stripFrontmatter };
