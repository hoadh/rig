# Extend Rig with Agents and Skills

Add your own agent, skill, or workflow to Rig. Edit files in your Rig clone (not the installed copy in `~/.claude`), then reinstall. Layer model: [System Components](../reference/system-components.md). Authoring rules: [Agent, Skill & Hook Authoring Standards](../reference/agent-skill-hook-authoring-standards.md).

## Add an agent

1. Create `.claude/agents/my-agent.md` with frontmatter:
   ```yaml
   ---
   name: my-agent
   description: Use this agent when ... (Claude picks agents by this text, so name the trigger situations)
   model: sonnet
   tools: Glob, Grep, Read, Bash
   ---
   ```
2. Below the frontmatter, write the agent's role, workflow, and output format.
3. Name the agent in skills or rules that should delegate to it (e.g. "spawn `my-agent` to ...").

## Add a skill

1. Create `.claude/skills/my-skill/SKILL.md` with frontmatter:
   ```yaml
   ---
   name: rig:my-skill        # invoked as /rig:my-skill
   description: "What it does and when to use it."
   argument-hint: "init|update"   # optional, shown in the slash menu
   ---
   ```
2. Write the workflow in `SKILL.md`. Keep it short; move long material to `references/*.md` and scripts to `scripts/`, and link them from `SKILL.md`.
3. For a knowledge-only skill, omit `argument-hint` and reference the skill from the agents that should load it.

## Add a custom workflow

1. Create `.claude/rules/my-workflow.md` describing the steps, which agent handles each step, and what each hands off.
2. Link it from the Workflows section of `CLAUDE.md` so sessions load it.

## Verify and install

1. Preview the install: `node scripts/install-kit-from-local-repo.cjs --dir ../my-app --dry-run`.
2. Install into one project first: `node scripts/install-kit-from-local-repo.cjs --dir ../my-app`.
3. Start a new Claude Code session in `../my-app`. Agent: ask Claude to use it by name. Skill: run `/rig:my-skill` or describe a matching task.
4. When it works, install globally with `--global`. This updates `~/.claude` for every project and merges `settings.json` (a backup is written). See [Install and update Rig](./install-and-update-rig.md).
