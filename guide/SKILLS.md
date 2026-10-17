# Skills Catalog

Every skill shipped in `.claude/skills/`. Invoke a skill with its command, for example `/rig:implement`. Claude also loads skills automatically when a task matches their description. Each skill's full instructions are in `.claude/skills/<dir>/SKILL.md`.

**Last Updated**: 2026-10-16
**Total Skills**: 32 (27 in the `/` menu, 5 internal helpers)

Legend: 📦 has executable scripts · 📚 has reference docs

## Plan and Build

| Command | Dir | | What it does |
|---|---|---|---|
| `/rig:brainstorm` | `brainstorm` | | Weigh solutions and trade-offs before any code: ideation, architecture decisions, feasibility. |
| `/rig:research` | `research` | | Research technical options, best practices and requirements. |
| `/rig:plan` | `rig-plan` | 📚 | Write a phased implementation plan in `plans/`, with optional red-team review and validation. |
| `/rig:implement` | `implement` | 📚 | Implement a feature or plan end to end: plan, code, test, review. |
| `/rig:fix` | `fix` | 📚 | Fix a bug end to end: explore, diagnose, fix, verify, review. |
| `/rig:debug` | `rig-debug` | 📦 📚 | Find the root cause only (logs, call stacks, CI failures), without applying a fix. |
| `/rig:test` | `test` | 📚 | Run unit, integration, e2e and UI tests; coverage and QA reports. |
| `/rig:code-review` | `code-review` | 📚 | Adversarial review of pending changes, a PR, a commit or the whole codebase. |

## Git, Delivery and Parallel Work

| Command | Dir | | What it does |
|---|---|---|---|
| `/rig:git` | `git` | 📚 | Stage, commit, push and merge with conventional commits; scans for secrets. |
| `/rig:pr` | `pr` | 📚 | One command from feature branch to pull request: merge main, test, review, push, open PR. |
| `/rig:worktree` | `worktree` | 📦 | Create an isolated git worktree for parallel development. |
| `/rig:team` | `team` | 📚 | Run Agent Teams: several independent Claude sessions working in parallel. |
| `/rig:remote` | `remote` | 📦 📚 | Run plan phases and tests on other machines (macOS, Linux, Windows) over ssh, then review and collect. See [Run a plan across machines](../docs/how-to/run-plan-across-machines.md). |

## Docs and Tracking

| Command | Dir | | What it does |
|---|---|---|---|
| `/rig:docs` | `docs` | 📚 | Create and update project docs in `docs/` (`init`, `update`, `summarize`, `restructure`). |
| `/diataxis-writer` | `diataxis-writer` | 📦 📚 | Write, classify and review pages with the Diataxis framework. |
| `/rig:devlog` | `devlog` | | Write devlog entries about recent changes in `docs/devlog/`. |
| `/rig:progress` | `progress` | 📚 | Track plan status, sync tasks and produce progress reports. |
| `/rig:visualize` | `visualize` | 📚 | Explanations, diagrams and slides as Markdown or self-contained HTML; view files. |
| `/rig:markdown-viewer` | `markdown-viewer` | 📦 | Read markdown files in a book-like local web viewer. |

## Frontend and Media

| Command | Dir | | What it does |
|---|---|---|---|
| `/rig:ui-design` | `ui-design` | 📦 📚 | UI/UX design guidance: layouts, design systems, accessibility, typography, color. |
| `/rig:ui-styling` | `ui-styling` | 📦 📚 | Build UIs with shadcn/ui and Tailwind CSS v4: components, themes, dark mode. |
| `/rig:browser` | `browser` | 📦 📚 | Automate a browser with Puppeteer: screenshots, performance, network, scraping, forms. |
| `/rig:media` | `media` | 📦 📚 | Analyze images, audio and video with Gemini; generate images, video, speech and music. |

## Tooling

| Command | Dir | | What it does |
|---|---|---|---|
| `/rig:explore` | `explore` | 📚 | Search the codebase fast with parallel agents. |
| `/rig:library-docs` | `library-docs` | 📦 📚 | Look up current library and framework docs (context7, llms.txt). |
| `/rig:mcp` | `mcp` | 📦 📚 | Discover and run tools from configured MCP servers. |
| `/rig:create-skill` | `create-skill` | 📦 📚 | Create or improve a skill, with evals and description optimization. |

## Internal Helpers

Hidden from the `/` menu (`user-invocable: false`). Other skills and agents load them when needed.

| Skill | | What it does |
|---|---|---|
| `context-engineering` | 📦 📚 | Check context and usage limits; optimize token use. |
| `sequential-thinking` | 📦 📚 | Step-by-step reasoning with revision for complex problems. |
| `problem-solving` | 📚 | Techniques for getting unstuck: simplification, inversion, scale game. |
| `project-organization` | 📚 | Decide where new files and reports go. |
| `mermaidjs-v11` | 📚 | Mermaid.js v11 diagram syntax. |

## See Also

- [Extend Rig with agents and skills](../docs/how-to/extend-rig-with-agents-and-skills.md)
- [Agent, skill and hook authoring standards](../docs/reference/agent-skill-hook-authoring-standards.md)
- [CHANGELOG](../CHANGELOG.md): release notes
