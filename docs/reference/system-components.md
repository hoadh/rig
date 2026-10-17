# System Components

Catalog of Rig layers and components, plus the technology stack. For why the system is shaped this way, see [Architecture](../explanation/architecture.md).

## Layers


### 1. Core Layer

#### 1.1 CLI Interface
**Location**: Claude Code CLI
**Responsibility**: User interaction and command routing
**Key Functions**:
- Parse slash commands
- Route to appropriate agent workflows
- Display results to users
- Manage conversation context

**Technology**: Anthropic Claude Code CLI

#### 1.2 Command Parser
**Location**: Built into CLI
**Responsibility**: Command interpretation and argument extraction
**Input**: Slash command with arguments (`/command arg1 arg2`)
**Output**: Parsed command and argument values
**Argument Variables**:
- `$ARGUMENTS` - All arguments as single string
- `$1, $2, $3...` - Individual positional arguments

#### 1.3 Configuration Manager
**Location**: `.claude/` directory
**Responsibility**: Load agent and command definitions
**File Types**:
- Agent definitions (`.md` with YAML frontmatter)
- Command definitions (`.md` with embedded agent calls)
- Skill modules (knowledge bases)
- Workflow templates
- Hook diagnostics logs (`.claude/hooks/.logs/hook-log.jsonl`)

#### 1.4 Hook Runtime Diagnostics
**Location**: `.claude/hooks/lib/hook-logger.cjs` and `.claude/hooks/.logs/hook-log.jsonl`
**Responsibility**: Persist structured hook execution telemetry for local inspection and downstream dashboard consumption
**Current Coverage**:
- `SessionStart`: `session-init`
- `SubagentStart`: `subagent-init`, `team-context-inject`
- `UserPromptSubmit`: `dev-rules-reminder`

**Log Contract**:
- One JSON object per line
- Common fields: `ts`, `hook`, `event`, `tool`, `target`, `note`, `dur`, `status`, `exit`, `error`
- Fail-open behavior preserved: diagnostics must never block normal hook execution

### 2. Agent Layer

#### 2.1 Agent Types (14 Agents)

**Planning Agents**:
- `planner` - Technical planning and architecture (Opus)
- `researcher` - Research and analysis
- `brainstormer` - Solution ideation

**Implementation Agents**:
- `implementer` - Implements plan phases (backend, frontend, infra)
- `ui-ux-designer` - Design creation and UX analysis
- `code-simplifier` - Code optimization and simplification

**Quality Assurance Agents**:
- `code-reviewer` - Code quality assessment and standards
- `tester` - Test creation and execution
- `debugger` - Issue analysis, root-cause diagnosis

**Documentation & Operations Agents**:
- `docs-maintainer` - Documentation maintenance
- `devlog-writer` - Devlog entries: shipped work, decisions, lessons
- `git-operator` - Version control and commit management
- `progress-tracker` - Progress tracking against plans
- `mcp-runner` - Runs MCP tools outside the main context (Gemini CLI first, `npx tsx` scripts as fallback)

#### 2.2 Agent Definition Structure

```yaml
---
name: agent-name
description: Agent purpose and use cases
mode: subagent | all
model: anthropic/claude-sonnet-4-20250514
temperature: 0.1
---

# Agent instructions in markdown
## Core Responsibilities
## Workflow Process
## Output Requirements
## Quality Standards
```

**Agent Modes**:
- `subagent`: Spawned by other agents, runs independently
- `all`: Can be invoked as main or sub agent

**Model Selection**:
- `opus` - planner, code-simplifier
- `sonnet` - debugger, implementer
- `haiku` - researcher, tester, docs-maintainer, git-operator, devlog-writer, progress-tracker, mcp-runner
- `inherit` - ui-ux-designer (uses the session model); agents without a `model` field also inherit

#### 2.3 Agent Communication Protocol

**Communication Medium**: File system (markdown files)
**Report Location**: `./plans/<plan-name>/reports/`
**Naming Convention**: `{date}-from-[source]-to-[dest]-[task]-report.md`

**Report Structure**:
```markdown
# Task Report: [Task Name]

**From**: [Source Agent]
**To**: [Destination Agent]
**Date**: YYYY-MM-DD
**Status**: [Complete|In Progress|Blocked]

## Summary
Brief overview of findings/results

## Details
Comprehensive information

## Recommendations
Actionable next steps

## Concerns
Issues, blockers, or questions
```

**Communication Patterns**:
1. **Request-Response**: Agent A requests, Agent B responds
2. **Broadcast**: Agent publishes report for multiple consumers
3. **Chain**: Sequential handoffs (A → B → C)
4. **Fan-Out**: Parallel execution (A spawns B, C, D)
5. **Fan-In**: Collect results from parallel agents

### 3. Command Layer

#### 3.1 Command Categories

**Core Development**:
- `/rig:plan` - Research and planning
- `/rig:implement` - Feature implementation
- `/rig:test` - Test execution
- `/rig:brainstorm` - Solution ideation
- `/rig:debug` - Deep analysis

**Skill Directories** (`.claude/skills/`):
- `docs/` - Documentation workflows
- `rig-plan/` - Planning workflow
- `code-review/` - Code review workflows
- `test/` - Testing workflows

#### 3.2 Command Workflow Pattern

```
User Input: /command [args]
    ↓
Command Parser
    ↓
Load Command Definition
    ↓
Substitute Arguments
    ↓
Execute Agent Workflow
    ↓
Sequential or Parallel Execution
    ↓
Collect Results
    ↓
Present to User
```

### 4. Workflow Layer

#### 4.1 Orchestration Patterns

**Sequential Chaining**:
```
Planner → Researcher → Planner → Main Agent → Tester → Code Reviewer → Docs Maintainer → Git Operator
```
Use when tasks have dependencies

**Parallel Execution**:
```
            ┌─→ Researcher (Auth) ─┐
Planner ────┼─→ Researcher (DB) ───┼─→ Planner (Synthesize)
            └─→ Researcher (UI) ───┘
```
Use for independent research tasks

**Query Fan-Out**:
```
Main Agent → Planner → [Multiple Researchers in Parallel] → Planner → Main Agent
```
Explore different approaches simultaneously

#### 4.2 Standard Workflows

**Feature Development Workflow**:
1. User: `/rig:implement "add user authentication"`
2. Planner: Create implementation plan
3. Researchers: Explore auth solutions (parallel)
4. Planner: Synthesize research, create detailed plan
5. Main Agent: Implement code
6. Main Agent: Run type checking/compilation
7. Tester: Write and run tests
8. (If tests fail): Debugger analyzes, loop to step 5
9. Code Reviewer: Review implementation
10. Docs Maintainer: Update documentation
11. Git Operator: Commit with conventional message

**Bug Fix Workflow**:
1. User: `/rig:debug "API timeout errors"`
2. Debugger: Analyze logs and system
3. Debugger: Identify root cause
4. Planner: Create fix plan
5. Main Agent: Implement solution
6. Tester: Validate fix
7. Code Reviewer: Review changes
8. Git Operator: Commit fix

**Documentation Update Workflow**:
1. User: `/rig:docs update`
2. Docs Maintainer: Check doc freshness
3. (If >1 day old): Run `repomix` for codebase summary
4. Docs Maintainer: Analyze codebase changes
5. Docs Maintainer: Update affected documentation
6. Docs Maintainer: Validate naming conventions
7. Docs Maintainer: Create update report

### 5. Skills Layer

#### 5.1 Skill Architecture

**Purpose**: Reusable knowledge modules for specific technologies

**Structure**:
```
.claude/skills/
└── [skill-name]/
    ├── SKILL.md           # Main skill definition
    ├── references/        # Supporting documentation
    │   ├── api-ref.md
    │   └── examples.md
    └── scripts/           # Utility scripts (if applicable)
```

**Skill Categories**:
- **Design**: UI/UX design guidance (ui-design)
- **Debugging**: Systematic approaches
- **Documentation**: library-docs
- **MCP**: Server management
- **Problem Solving**: Meta-patterns, thinking frameworks
- **UI Frameworks**: shadcn/ui, Tailwind CSS

#### 5.2 Skill Invocation

**Invocation**: `Skill` tool in CLI
**Usage**: Agents invoke skills to access specialized knowledge
**Example**:
```
Planner needs Next.js expertise
  ↓
Invokes "nextjs" skill
  ↓
Skill provides implementation guidance
  ↓
Planner incorporates into plan
```

### 6. Integration Layer

#### 6.1 Hook System (4 Core Hooks)

**Purpose**: Intercept and control Claude Code operations for performance, context management, and security

**Hook Architecture**:
All hooks located in `.claude/hooks/` with consistent patterns - fail-safe exit code 0 (non-blocking)

**Native features instead of hooks**:

- Sensitive files and heavy directories: `permissions.ask` / `permissions.deny` in `.claude/settings.json`
- File naming: rule in `.claude/rules/development-rules.md`
- Context usage: statusline reads `rate_limits` from stdin

**1. Session-Init Hook** (`session-init.cjs`)
- **Trigger**: SessionStart (startup, resume, clear, compact)
- **Purpose**: Export Rig session vars and paths
- **Exports**: `RIG_SESSION_ID`, `RIG_PLAN_DATE_FORMAT`, `RIG_NAME_PATTERN`, `RIG_ACTIVE_PLAN`, `CLAUDE_CODE_TASK_LIST_ID`, `RIG_REPORTS_PATH`, `RIG_PLANS_PATH`, `RIG_PROJECT_ROOT`, `RIG_GIT_BRANCH`

**2. Dev-Rules-Reminder Hook** (`dev-rules-reminder.cjs`)
- **Trigger**: Every user prompt (UserPromptSubmit)
- **Purpose**: Inject dynamic session facts only
- **Output**: `## Rig Session` block (datetime, paths, plan context, naming). Static rules are read from `.claude/rules/`, not injected.

**3. Subagent-Init Hook** (`subagent-init.cjs`)
- **Trigger**: SubagentStart
- **Purpose**: Give subagents the dynamic Rig context (paths, plan context, naming)
- **Note**: Static rules stay in `.claude/rules/`; only dynamic facts are injected

**4. Team-Context Hook** (`team-context-inject.cjs`)
- **Trigger**: SubagentStart (agent teams only)
- **Purpose**: Inject team peers and task context

**Hook Features Summary**:
- Fail-Safe: All hooks exit 0 (non-blocking) - graceful degradation
- Performance: Small injected output
- Cross-Platform: Node.js `.cjs` scripts for Windows and Unix
- Testing: `npm test` runs all hook test files

#### 6.1a Statusline (`.claude/statusline.cjs`)

**Purpose**: Show live session state in Claude Code's status bar. Reads the statusline JSON from stdin; no external dependencies.

**Modules** (`.claude/hooks/lib/`):
- `statusline-segment-renderers.cjs`: segments, row wrapping, tools/agents/todos lines
- `statusline-text-formatters.cjs`: width measurement, truncation, token/duration formatting
- `colors.cjs`: 256-color palette, `badge`, heat-gradient `gradientBar` (respects `NO_COLOR`)
- `transcript-parser.cjs`, `git-info-cache.cjs`, `config-counter.cjs`: data sources

**Full layout** (each row wraps by segment at 85% of terminal width):
1. Session: model badge (+ agent), context bar + % + tokens used/size, 5h and 7d limits with reset countdown, cost, session/API time, total tokens in/out
2. Workspace: directory, git branch + staged/unstaged/ahead/behind, active plan, lines +/-, config counts (CLAUDE.md, rules, MCP, hooks), output style, vim mode, version
3. Activity (only when present): running tool or recent tool summary, agent flow, todo progress bar

**Modes** (`statusline` in `.rig.json`): `full` (default), `compact` (2 lines), `minimal` (1 line), `none`. `statuslineColors: false` disables colors.

**Cost**: hidden when `rate_limits` is present (Pro/Max), unless `CLAUDE_BILLING_MODE=api`.

**Tests**: `node .claude/hooks/lib/__tests__/statusline-suite.cjs`

#### 6.2 MCP (Model Context Protocol) Integration

**Available MCP Servers**:

**library-docs** skill (Documentation):
- Read latest docs for packages/plugins
- Access up-to-date technical information

**sequential-thinking** skill (Problem Solving):
- Structured thinking process
- Break down complex problems
- Reflective analysis

**media** skill (Visual Analysis):
- Describe images, videos, documents
- UI/UX analysis from screenshots

**media skill** (Generation & Processing):
- Generate images, videos, and documents via media

**brain** (Advanced Reasoning):
- Sequential thinking
- Code analysis
- Debugging assistance

#### 6.3 Preview Dashboard System (COMPLETE - Phase 6)

**Purpose**: Interactive web-based visualization of implementation plans and project progress

**Architecture**:
```
.claude/skills/markdown-viewer/
├── scripts/
│   ├── server.cjs              # HTTP server & request handler
│   ├── lib/
│   │   ├── plan-scanner.cjs    # Plan discovery & metadata extraction
│   │   ├── dashboard-renderer.cjs  # Plan cards & dashboard rendering
│   │   ├── plan-navigator.cjs  # Plan file parsing & traversal
│   │   ├── markdown-renderer.cjs  # Markdown to HTML conversion
│   │   ├── http-server.cjs     # HTTP server utilities
│   │   ├── port-finder.cjs     # Available port detection
│   │   └── process-mgr.cjs     # Process management
│   ├── tests/                  # Test suites
│   └── ...                     # Other modules
├── assets/
│   ├── dashboard-template.html # Dashboard UI template
│   ├── dashboard.css           # Dashboard styles + theme
│   └── dashboard.js            # Interactive dashboard logic
└── SKILL.md                    # Skill documentation
```

**Core Components** (All 6 Phases Complete):

**Phase 1-2: Infrastructure**
- Plan Scanner, HTTP Server, Port detection utilities
- Real-time plan discovery & metadata extraction
- Security validation (path traversal prevention)

**Phase 3-4: API & Data**
- `/dashboard` route with HTML UI
- `/api/dashboard` JSON API endpoint
- Comprehensive metadata extraction (name, progress, status, phases, timestamps)

**Phase 5-6: UI & Features** (COMPLETE)
1. **Dashboard Renderer** (`dashboard-renderer.cjs`):
   - Generates plan cards with progress visualization
   - Calculates progress rings and status bars
   - Supports sorting: by date, alphabetically, by progress
   - Real-time filtering by status (all/pending/active/completed)
   - Full-text search across plan names and descriptions

2. **Dashboard Template** (`dashboard-template.html`):
   - Responsive grid layout (auto-fit cards)
   - Sticky header with controls
   - Search bar with debounced input
   - Sort/filter dropdowns
   - Plan cards with metadata

3. **Dashboard Styles** (`dashboard.css`):
   - Dark/light theme support with CSS variables
   - WCAG 2.1 AA color contrast compliance
   - Progress ring visualization (SVG-based)
   - Responsive design (mobile-first)
   - Smooth transitions and animations

4. **Dashboard Logic** (`dashboard.js`):
   - Client-side filtering and sorting
   - Theme toggle (persisted in localStorage)
   - Real-time search with regex support
   - Accessibility features (keyboard navigation, ARIA labels)
   - Plan card interactions and detail views

**Data Flow**:
```
User Request (/dashboard)
    ↓
HTTP Server
    ↓
Plan Scanner (discovers plans in ./plans)
    ↓
Dashboard Renderer (generates cards with progress)
    ↓
Dashboard Template (renders HTML with cards)
    ↓
Dashboard JS (enables interactivity)
    ↓
User sees sorted/filtered plan grid
```

**Features Complete**:
- Real-time plan discovery (no manual updates)
- Interactive card-based grid layout
- Progress tracking with percentage calculation & rings
- Status derivation (pending/in-progress/completed)
- Sorting: date (newest first), alphabetical, progress %
- Filtering: all, pending, active, completed
- Full-text search with highlighting
- Dark/light theme toggle with persistence
- WCAG 2.1 AA accessibility compliance
- Responsive mobile-friendly design
- Phase breakdown with status indicators
- Timestamp tracking for plan modifications
- Security-validated path traversal

#### 6.4 External Service Integration

**GitHub**:
- Actions (CI/CD automation)
- Releases (semantic versioning)
- Issues and PRs (project management)

**Discord**:
- Webhook notifications
- Project updates
- Team communication

**NPM** (Optional):
- Package publishing
- Version management

### 7. Data Layer

#### 7.1 File-Based Storage

**Configuration Data**:
- `.claude/` - Claude Code config
- `.gitignore` - Git exclusions
- `package.json` - Node.js config

**Runtime Data**:
- `plans/` - Implementation plans
- `plans/<plan-name>/reports/` - Agent communication
- `plans/<plan-name>/research/` - Research reports
- `docs/` - Project documentation
- `repomix-output.xml` - Codebase compaction

**Version Control**:
- `.git/` - Git repository
- `CHANGELOG.md` - Version history
- Git tags - Release versions

#### 7.2 Data Flow

```
User Input
    ↓
Command Parsing
    ↓
Agent Execution
    ↓
File System (Reports/Plans)
    ↓
Agent Reading
    ↓
Processing
    ↓
File System (Updated Docs/Code)
    ↓
Version Control (Git)
    ↓
Remote Repository (GitHub)
```

## Technology Stack

### Core Technologies

**Runtime Environment**:
- Node.js >= 18.0.0
- Bash scripting (hooks)

**AI Platforms**:
- Anthropic Claude (Opus, Sonnet, Haiku)
- Google Gemini and MiniMax (`/rig:media`, optional)
- Gemini CLI (`/rig:mcp`, `mcp-runner`, `/rig:research`; optional, falls back when missing)

**Development Tools**:
- Repomix (codebase compaction)

**CI/CD**:
- GitHub Actions
- Conventional Commits
- Semantic Versioning

### Agent Skills Ecosystem

**Sequential Thinking**: Problem decomposition
**brain**: Advanced reasoning
**library-docs**: Documentation access
**media**: Visual understanding
**media skill**: Content generation and processing
