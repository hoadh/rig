# Claude Code Hooks

This directory contains hooks for Claude Code sessions.

## Hooks Overview

| Hook | Location | Description |
|------|----------|-------------|
| **Session Init** | `session-init.cjs` | Session startup initialization (SessionStart) |
| **Subagent Init** | `subagent-init.cjs` | Subagent context injection (SubagentStart) |
| **Team Context** | `team-context-inject.cjs` | Agent team context injection (SubagentStart) |
| **Dev Rules** | `dev-rules-reminder.cjs` | Dynamic session facts: date, paths, plan context, naming (UserPromptSubmit) |

Access control and file naming are no longer hooks. See [Permission Rules](#permission-rules) and the Rig core rules (`rules/core-rules.md`).

## Notifications

Use the built-in `PushNotification` tool (and the `Notification` hook event in your own settings) instead of a kit-shipped webhook hook.

## Permission Rules

Sensitive-file prompts and heavy-directory blocks use Claude Code permission rules in `.claude/settings.json`, not hooks.

| Key | Effect | Examples |
|-----|--------|----------|
| `permissions.ask` | Prompts before access | `Read(**/.env)`, `Read(**/*.pem)`, `Edit(**/.env)` |
| `permissions.deny` | Blocks access | `Read(**/node_modules/**)`, `Read(**/.venv/**)` |

Add custom patterns to these arrays. Bash commands are not filtered by these rules.

## Security

1. **Never commit secrets** - Add `.env` to `.gitignore`
2. **Use environment variables** - Never hardcode credentials

## Troubleshooting

**Hooks not triggering:**
- Verify hooks are added to `.claude/settings.json`
- Check Claude Code is using correct settings file

**Sensitive file prompts or heavy-directory blocks not applying:**
- Check the `permissions.ask` and `permissions.deny` arrays in `.claude/settings.json`

---

**Last Updated:** 2026-10-16
