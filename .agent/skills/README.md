# Skills
Skills are folders of instructions, scripts, and resources that Claude loads dynamically to improve performance on specialized tasks. Skills teach Claude how to complete specific tasks in a repeatable way, whether that's creating documents with your company's brand guidelines, analyzing data using your organization's specific workflows, or automating personal tasks.

For more information, check out:
- [What are skills?](https://support.claude.com/en/articles/12512176-what-are-skills)
- [Using skills in Claude](https://support.claude.com/en/articles/12512180-using-skills-in-claude)
- [How to create custom skills](https://support.claude.com/en/articles/12512198-creating-custom-skills)
- [Equipping agents for the real world with Agent Skills](https://anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)

# About This Repository

This directory contains the Rig skills library. Each skill is self-contained in its own directory with a `SKILL.md` file containing the instructions and metadata that Claude uses. The `common/` directory holds the shared library used by several skills.

Browse the skill directories to see how skills are structured, or use the **create-skill** skill as a starting point for new skills.

# Installation

Some skills require external dependencies (FFmpeg, ImageMagick, Node.js packages, Python packages). Use our automated installation scripts to set up all dependencies:

## Automated Installation (Recommended)

**Linux/macOS:**
```bash
cd .agent/skills
./install.sh
```

**Windows (PowerShell as Administrator):**
```powershell
cd .claude\skills
.\install.ps1
```

The installation scripts will:
- Install system tools (FFmpeg, ImageMagick)
- Install Node.js packages (pnpm, repomix)
- Create Python virtual environment
- Install Python packages (google-genai, pypdf, Pillow, etc.)
- Install test dependencies
- Verify all installations

## Manual Installation

For manual installation or troubleshooting, see [INSTALLATION.md](INSTALLATION.md) for detailed instructions.

## What Gets Installed

- **System Tools**: FFmpeg, ImageMagick
- **Node.js Packages**: pnpm, repomix
- **Python Packages**: google-genai, pypdf, python-docx, Pillow, pytest

See [INSTALLATION.md](INSTALLATION.md) for complete dependency list and platform-specific instructions.

# Try in Claude Code, Claude.ai, and the API

## Claude Code
You can register this repository as a Claude Code Plugin marketplace by running the following command in Claude Code:
```
/plugin marketplace add anthropics/skills
```

After installing the plugin, you can use a skill by just mentioning it. For instance, you can ask Claude Code to do something like: "use the media skill to describe path/to/some-image.png"

## Claude.ai

To use any skill from this repository or upload custom skills, follow the instructions in [Using skills in Claude](https://support.claude.com/en/articles/12512180-using-skills-in-claude#h_a4222fa77b).

## Claude API

You can use Anthropic's pre-built skills, and upload custom skills, via the Claude API. See the [Skills API Quickstart](https://docs.claude.com/en/api/skills-guide#creating-a-skill) for more.

# Creating a Basic Skill

Skills are simple to create - just a folder with a `SKILL.md` file containing YAML frontmatter and instructions. You can use the **create-skill** skill in this repository as a starting point:

```markdown
---
name: my-skill-name
description: A clear description of what this skill does and when to use it
---

# My Skill Name

[Add your instructions here that Claude will follow when this skill is active]

## Examples
- Example usage 1
- Example usage 2

## Guidelines
- Guideline 1
- Guideline 2
```

The frontmatter requires only two fields:
- `name` - A unique identifier for your skill (lowercase, hyphens for spaces)
- `description` - A complete description of what the skill does and when to use it

The markdown content below contains the instructions, examples, and guidelines that Claude will follow. For more details, see [How to create custom skills](https://support.claude.com/en/articles/12512198-creating-custom-skills).

# Partner Skills

Skills are a great way to teach Claude how to get better at using specific pieces of software. As we see awesome example skills from partners, we may highlight some of them here:

- **Notion** - [Notion Skills for Claude](https://www.notion.so/notiondevs/Notion-Skills-for-Claude-28da4445d27180c7af1df7d8615723d0)
