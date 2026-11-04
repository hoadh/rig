# Set the response language

Claude can answer in your language while everything that lands in the repository stays English.

## Steps

1. Set Claude Code's `language` setting in a settings file:

   ```json
   { "language": "Vietnamese" }
   ```

   | File | Scope |
   |---|---|
   | `~/.claude/settings.json` | All your projects |
   | `.claude/settings.json` | This project, shared with the team |
   | `.claude/settings.local.json` | This project, only you |

2. Start a new session. Chat replies now follow that language.

## What stays English

Only chat replies change. Code, comments, docs, plans, commit messages, branch names and paths stay English. This is a rule in `.claude/rules/development-rules.md` (section "Language"), so it also applies to subagents.

## Deprecated

`locale.responseLanguage` in `.rig.json` is deprecated. Use the Claude Code `language` setting.
