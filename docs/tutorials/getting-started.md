# Getting Started with Rig

In this tutorial you install the Rig plugin, ask Rig to plan a feature in a small demo project, and let it build the feature. At the end you have a working `hello` script, a plan in `plans/`, and a feel for the plan → cook loop that every Rig workflow uses.

You need [Claude Code](https://code.claude.com/docs/en/setup) 2.1.292 or newer, Git, and Node.js 18+. The tutorial takes about 15 minutes.

## 1. Create a demo project

```bash
mkdir ../rig-demo
cd ../rig-demo
git init
npm init -y
```

`../rig-demo` is an empty Node project. Rig does not write into it until you run a Rig command there.

## 2. Install the Rig plugin

Start Claude Code in any folder and run:

```text
/plugin marketplace add hoadh/rig
/plugin install rig@rig-marketplace
```

Restart Claude Code. Then run `/rig:setup`. It previews the setup and prints the terminal commands. For this tutorial you need only the runtime and permissions groups, so run these in a terminal, outside Claude Code:

```bash
rig-init --runtime
rig-init --permissions
```

Each command shows what it will change and asks `y/N`. Full details: [Install and update Rig](../how-to/install-and-update-rig.md).

## 3. Start Claude Code in the demo project

```bash
cd ../rig-demo
claude
```

When the session starts, Rig's session hook adds Rig's project context to the session. That is how you know the hooks run: `/rig:` commands appear in the slash menu.

## 4. Plan a feature

In the Claude Code prompt, type:

```
/rig:plan --fast "add a hello.js script that prints Hello, Rig! and an npm start script that runs it"
```

Rig explores the project and writes a plan. When it finishes, it prints the plan path, for example `plans/<date>-hello-script/plan.md`. Open that file: it lists the phases and TODOs Rig will follow.

## 5. Build the feature from the plan

Copy the plan path from step 4 and run:

```
/rig:implement plans/<date>-hello-script/plan.md
```

Rig implements the plan, runs tests and a code review, and stops at review gates to ask for your approval. Approve each gate.

## 6. See the result

Exit Claude Code and run:

```bash
npm start
```

The output is `Hello, Rig!`.

## What you did

You installed the Rig plugin, used `/rig:plan` to turn a request into a written plan, and used `/rig:implement` to build from that plan with tests and review. Larger features use the same two commands.

## Next steps

- Update Rig, or migrate from 1.x: [Install and update Rig](../how-to/install-and-update-rig.md), [Migrate from Rig 1.x](../how-to/migrate-from-rig-1x.md).
- Learn how the agents and skills fit together: [Architecture](../explanation/architecture.md).
- Add your own agent or skill: [Extend Rig with Agents and Skills](../how-to/extend-rig-with-agents-and-skills.md).
- Browse all docs: [Documentation index](../README.md).
