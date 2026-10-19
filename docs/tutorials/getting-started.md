# Getting Started with Rig

In this tutorial you install Rig into a small demo project, ask Rig to plan a feature, and let it build the feature. At the end you have a working `hello` script, a plan in `plans/`, and a feel for the plan → cook loop that every Rig workflow uses.

You need [Claude Code](https://code.claude.com/docs/en/setup), Git, and Node.js 18+. The tutorial takes about 15 minutes.

## 1. Get the Rig repo

```bash
git clone git@github.com:hoadh/rig.git
cd rig
```

You now have the kit source in `rig/`. The installer lives in `scripts/`.

## 2. Create a demo project

```bash
mkdir ../rig-demo
cd ../rig-demo
git init
npm init -y
cd ../rig
```

`../rig-demo` is an empty Node project. You will install Rig into it, so nothing outside it changes.

## 3. Preview the install

```bash
node scripts/install-kit-from-local-repo.cjs --dir ../rig-demo --dry-run
```

The installer prints a summary like `636 kit files: would write 635` and `settings.json: would write`. It writes nothing yet.

## 4. Install Rig into the demo project

```bash
node scripts/install-kit-from-local-repo.cjs --dir ../rig-demo
```

Check the result:

```bash
ls ../rig-demo ../rig-demo/.claude
```

The project now has `CLAUDE.md` and `AGENTS.md`, and `.claude/` contains `agents`, `hooks`, `rules`, `skills`, and `settings.json` (among others). Rig is now active for any Claude Code session started in `rig-demo`.

## 5. Start Claude Code in the demo project

```bash
cd ../rig-demo
claude
```

When the session starts, Rig's session hook shows a line like `Session startup. Project: library | Plan naming: {date}-{issue}-{slug}`. That line tells you the hooks are running.

## 6. Plan a feature

In the Claude Code prompt, type:

```
/rig:plan --fast "add a hello.js script that prints Hello, Rig! and an npm start script that runs it"
```

Rig explores the project and writes a plan. When it finishes, it prints the plan path, for example `plans/<date>-hello-script/plan.md`. Open that file: it lists the phases and TODOs Rig will follow.

## 7. Build the feature from the plan

Copy the plan path from step 6 and run:

```
/rig:implement plans/<date>-hello-script/plan.md
```

Rig implements the plan, runs tests and a code review, and stops at review gates to ask for your approval. Approve each gate.

## 8. See the result

Exit Claude Code and run:

```bash
npm start
```

The output is `Hello, Rig!`.

## What you did

You installed Rig into one project, used `/rig:plan` to turn a request into a written plan, and used `/rig:implement` to build from that plan with tests and review. Larger features use the same two commands.

## Next steps

- Install Rig for every project or update it: [Install and update Rig](../how-to/install-and-update-rig.md).
- Learn how the agents and skills fit together: [Architecture](../explanation/architecture.md).
- Add your own agent or skill: [Extend Rig with Agents and Skills](../how-to/extend-rig-with-agents-and-skills.md).
- Browse all docs: [Documentation index](../README.md).
