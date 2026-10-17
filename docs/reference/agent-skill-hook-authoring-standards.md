# Agent, Skill & Hook Authoring Standards

Rules for writing Rig kit files: agent, command, and skill definitions, hooks, and configuration files. General code rules: [Code Standards](./code-standards.md). Step-by-step extension: [Extend Rig with Agents and Skills](../how-to/extend-rig-with-agents-and-skills.md).

## Agent-Specific Standards

### Agent Definition Files

**Frontmatter**:
```yaml
---
name: agent-name
description: Brief description of agent purpose and when to use it
mode: subagent | all
model: anthropic/claude-sonnet-4-20250514
temperature: 0.1
---
```

**Required Sections**:
1. Agent role and responsibilities
2. Core capabilities
3. Workflow process
4. Output requirements
5. Quality standards
6. Communication protocols

### Command Definition Files

**Frontmatter**:
```yaml
---
name: command-name
description: What this command does
---
```

**Argument Handling**:
- `$ARGUMENTS` - All arguments as single string
- `$1`, `$2`, `$3` - Individual positional arguments

**Example**:
```markdown
---
name: plan
description: Create implementation plan for given task
---

Planning task: $ARGUMENTS

Using planner agent to research and create comprehensive plan for: $1
```

### Skill Definition Files

**Structure**:
```markdown
# Skill Name

Guide for using [Technology] - brief description

## When to Use

- List of use cases
- Scenarios where skill applies

## Core Concepts

Key concepts and terminology

## Implementation Guide

Step-by-step instructions

## Examples

Practical examples

## Best Practices

Recommendations and tips

## Common Pitfalls

Mistakes to avoid

## Resources

- Official docs
- Tutorials
- References
```

## Hook Implementation Standards

Rig keeps few hooks: `session-init`, `subagent-init`, `team-context-inject` and `dev-rules-reminder`. Use a native feature first (permission rules in `.claude/settings.json`, a rule in `.claude/rules/`, or a skill). Add a hook only when none fits.

**Implementation Requirements**:
- Pure Node.js (`.cjs`), no dependencies
- Read stdin, validate JSON, catch errors
- Fail open: exit 0 on internal errors so a hook never blocks Claude
- Inject only dynamic facts (paths, plan context, date). Static rules belong in `.claude/rules/`
- Register with the `node "$CLAUDE_PROJECT_DIR"/.claude/hooks/<name>.cjs` form

**Testing Standards**:
- Test the normal output and the error path (invalid JSON, empty input, missing fields)
- Cross-platform test coverage
- Clear pass/fail indicators

## Configuration File Standards

### package.json

**Required Fields**:
- name, version, description
- repository (with URL)
- author, license
- engines (Node version >= 18.0.0)
- scripts (test, lint, etc.)

**Best Practices**:
- Use semantic versioning
- Specify exact dependency versions for stability
- Include keywords for discoverability
- Use `files` field to control published content
- Specify minimum Node.js version (18.0.0+)

### .gitignore

**Standard Exclusions**:
```
# Dependencies
node_modules/
package-lock.json (for libraries)

# Environment
.env
.env.*
!.env.example

# Build outputs
dist/
build/
*.log

# IDE
.vscode/
.idea/
*.swp

# OS
.DS_Store
Thumbs.db

# Testing
coverage/
*.test.js.snap

# Temporary
tmp/
temp/
*.tmp
```
