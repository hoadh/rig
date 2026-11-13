# Extend Rig with Agents and Skills

Add your own agent or skill to Rig. Edit files in your Rig clone under `plugins/rig/`, test them with `--plugin-dir`, then ship them as a release. Do not edit the installed copy in the plugin cache.

Layer model: [System Components](../reference/system-components.md). Authoring rules: [Agent, Skill & Hook Authoring Standards](../reference/agent-skill-hook-authoring-standards.md).

## Add an agent

1. Create `plugins/rig/agents/my-agent.md` with frontmatter:
   ```yaml
   ---
   name: my-agent
   description: Use this agent when ... (Claude picks agents by this text, so name the trigger situations)
   model: sonnet
   tools: Glob, Grep, Read, Bash
   ---
   ```
2. Below the frontmatter, write the agent's role, workflow, and output format.
3. Name the agent in skills that should delegate to it (for example "spawn `my-agent` to ..."). Claude Code reports plugin agents with the `rig:` prefix (`rig:my-agent`).

## Add a skill

1. Create `plugins/rig/skills/my-skill/SKILL.md` with frontmatter:
   ```yaml
   ---
   name: my-skill            # the plugin adds the rig: namespace: /rig:my-skill
   description: "What it does and when to use it."
   argument-hint: "init|update"   # optional, shown in the slash menu
   ---
   ```
2. Write the workflow in `SKILL.md`. Keep it short. Move long material to `references/*.md` and scripts to `scripts/`, and link them from `SKILL.md`.
3. Call other Rig scripts by their `bin/` name (`rig-worktree`, `rig-python`, `rig-skill-dir <skill>`). Do not hard-code install paths: the plugin cache path changes on every update.
4. For a knowledge-only skill, set `user-invocable: false` and reference the skill from the agents that should load it.

## Add a workflow

Put the steps in a skill, not in a rules file. The always-loaded rules are `plugins/rig/rules/core-rules.md` and stay short. A workflow skill names which agent handles each step and what each hands off; users reach it through `/rig:<name>`.

## Test and ship

1. Load the plugin from your clone for one session:
   ```bash
   claude --plugin-dir ./plugins/rig
   ```
2. Validate the manifest and the marketplace entry: `claude plugin validate ./plugins/rig --strict` and `claude plugin validate .`.
3. Start a session and call the new skill (`/rig:my-skill`), or describe a task that should load the agent.
4. Run `npm run lint` and `npm test`. The Antigravity plugin in `antigravity/rig/` is generated: run `npm run sync:antigravity` and commit the result. Do not edit `antigravity/rig/` by hand.
5. Bump `version` in `plugins/rig/.claude-plugin/plugin.json` for any change under `plugins/rig/`. CI fails a change without a greater version. Users receive the change through the marketplace; see [Install and update Rig](./install-and-update-rig.md).
