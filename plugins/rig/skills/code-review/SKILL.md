---
name: code-review
description: "Review code with adversarial rigor: pending changes, PR number, commit or codebase scan; red-team for security holes and failure modes. Use before merging."
argument-hint: "[#PR | COMMIT | --pending | codebase [parallel]]"
metadata:
  author: rig
  version: "1.1.0"
---

# Code Review

Rig adds two things on top of the built-in `/code-review`: a red-team pass and a full-codebase scan.

## Diff review (PR, commit, pending)

1. Resolve the target: `#123` or PR URL = PR; 7+ hex chars = commit; `--pending` or no argument = staged and unstaged changes. Ask via `AskUserQuestion` if nothing is reviewable.
2. Pending changes, branch or PR targets: run the built-in `/code-review <target>` and keep its findings. Fallback, used for a commit hash, when `/code-review` cannot be invoked from this skill (unknown command, no output), or when it cannot run (not a git repo, no `gh`): spawn the `code-reviewer` agent on `git show` / `git diff` / `gh pr diff`.
3. Red-team pass: read `references/adversarial-review.md` and run it on the same diff. It has a scope gate; skip only below that threshold and say so.
4. Report built-in findings and a `## Red-team` section separately, each with severity and file:line. Critical findings block merge.

Checklists for pre-landing reviews live in `references/checklist-workflow.md` and `references/checklists/`; `references/spec-compliance-review.md` checks work against its plan.

## codebase

| Argument | Reference |
|---|---|
| `codebase` | `references/codebase-scan-workflow.md` |
| `codebase parallel` | `references/parallel-review-workflow.md` |

## Rules

- Evidence before claims: run the tests or commands and read the output before saying anything passes.
- When receiving review feedback, verify it against the code first; push back on wrong findings.
