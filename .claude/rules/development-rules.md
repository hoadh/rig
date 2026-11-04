# Development Rules

Principles: YAGNI, KISS, DRY. Do the simplest thing that works.

## General
- File names: kebab-case, descriptive enough that Grep/Glob output explains the file (JS/TS/Python/shell). Follow the language convention elsewhere (C#/Java/Kotlin/Swift PascalCase, Go/Rust snake_case).
- File size: split a file when it mixes concerns or passes ~500 lines; data, generated and test files are exempt (see `docs/reference/code-standards.md`). Prefer extracted utilities and focused modules over inheritance.
- Follow the structure and standards in `./docs`.
- Implement real behavior, not simulations or mocks; a mock that passes proves nothing.
- Update existing files directly; do not create "enhanced" copies.
- Look up current library docs with the `library-docs` skill. Use `gh` for GitHub, `psql` for Postgres debugging, the `media`/`imagemagick` skills for images and video, `sequential-thinking`/`debug` for hard analysis.

## Code Quality
- Code must compile and have no syntax errors; style strictness comes second to readability and productivity.
- Handle errors with try/catch at boundaries and validate external input.
- Review scales with the tier in `primary-workflow.md`; do not run a reviewer on a one-line fix.

## Commit and Push
- Lint before commit, run tests before push. Never ignore a failing test to get a green build.
- Never commit secrets (dotenv files, API keys, credentials): a pushed secret must be treated as leaked.
- Keep commits focused. Conventional commit messages, no AI references.

## Privileged Steps (sudo, docker, system services)
- Do all non-privileged prep first (downloads, config files, checks). Do not ask the user to edit files you can prepare.
- Give the user one fenced block with every privileged command in order, copy-paste runnable, including the exact start/launch command (e.g. `sudo systemctl restart x`, `docker compose up -d`) and how you will verify it.
- Wait for "done", then verify yourself (status, logs, version) and report the evidence.
- Do not interleave privileged requests one at a time; it stalls the user repeatedly.

## Remote Hosts and SSH
- Resolve user/host with `ssh -G <host>` (reads `~/.ssh/config`; check the `user` and `hostname` lines). A `user` equal to the local login with no matching `Host` block means not configured.
- No User configured: ask the user once, then offer to add a `Host <alias>` entry (`HostName`, `User`) to `~/.ssh/config` so it is not asked again. Write it only if the user agrees; never put keys or passwords there.
- Never infer users or hosts from shell history, known_hosts or other projects; guesses connect to the wrong machine.
- Production hosts are read-only: inspection only (`tail`, `cat`, `grep`, `journalctl`, `ls`, `df`, `ps`, `systemctl status`). Any state change (writes, restarts, deploys, installs) needs explicit user approval, because production outages are costly and hard to undo.

## Language
- Only chat replies follow the user's language (Claude Code's `language` setting in settings.json sets it persistently).
- Everything that lands in the repo is English: code, comments, docs, plans, commit messages, branch names, paths.
