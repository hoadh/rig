# Skills Installation Guide

This guide explains how to install dependencies for Claude Code skills.

## Overview

Skills are organized into groups with Python utility scripts. Each skill's scripts directory contains a `requirements.txt` file listing dependencies.

## Automated Installation (Recommended)

Use the provided installation scripts for automated setup:

### Linux/macOS

```bash
cd .claude/skills
chmod +x install.sh
./install.sh
```

The script will:
- Detect your OS (Linux or macOS)
- Install package managers (Homebrew for macOS, apt-get for Linux)
- Install system dependencies (FFmpeg, ImageMagick)
- Install Node.js and global packages (pnpm, repomix)
- Create Python virtual environment
- Install Python packages for all skills
- Install test dependencies
- Verify all installations

### Windows (PowerShell)

Run as Administrator:

```powershell
cd .claude\skills
Set-ExecutionPolicy Bypass -Scope Process -Force
.\install.ps1
```

Options:
```powershell
# Skip Chocolatey installation if already installed
.\install.ps1 -SkipChocolatey

# Show help
.\install.ps1 -Help
```

The script will:
- Install Chocolatey package manager (if needed)
- Install system dependencies (FFmpeg, ImageMagick)
- Install Node.js and global packages
- Create Python virtual environment
- Install Python packages
- Verify all installations

From Git Bash/MSYS/Cygwin, `install.sh` exits with a hint; run the installer from PowerShell instead:

```powershell
powershell -ExecutionPolicy Bypass -File .claude\skills\install.ps1
```

On Windows use `python` (not `python3`, which is a Microsoft Store stub) and `.venv\Scripts\python.exe` (not `.venv/bin/python3`).

### What Gets Installed

**System Tools:**
- FFmpeg (video/audio processing)
- ImageMagick (image processing)

**Node.js Packages (global):**
- pnpm (package manager)
- repomix (repository packaging)

**Python Packages:**
- google-genai (Gemini API)
- pypdf, python-docx (document processing)
- Pillow (image processing)
- pytest, pytest-cov (testing)

## Manual Installation

If you prefer manual installation or the automated script fails:

## Quick Start

### Option 1: Install All Dependencies (Recommended)

```bash
# Create virtual environment
python3 -m venv .venv  # On Windows: python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
# If `python3` is not found, try `python`, then `py -3`.

# Install all skill dependencies
pip install -r .claude/skills/media/scripts/requirements.txt

# Install test dependencies for development
pip install pytest pytest-cov pytest-mock
```

### Option 2: Install Per-Skill

Navigate to specific skill and install:

```bash
cd .claude/skills/media/scripts
pip install -r requirements.txt
```

## Skills Dependencies

### Python Package Dependencies

Most skills use only Python standard library. Only **media** requires external packages:

**media** (`.claude/skills/media/scripts/requirements.txt`):
- `google-genai>=0.1.0` - Google Gemini API
- `pypdf>=4.0.0` - PDF processing
- `python-docx>=1.0.0` - DOCX conversion
- `docx2pdf>=0.1.8` - PDF conversion (Windows only)
- `markdown>=3.5.0` - Markdown processing
- `Pillow>=10.0.0` - Image processing
- `python-dotenv>=1.0.0` - Environment variables

### System Tool Dependencies

Several skills require external CLI tools:

#### media (FFmpeg, ImageMagick)
- **FFmpeg**: Video/audio processing
  - Ubuntu/Debian: `sudo apt-get install ffmpeg`
  - macOS: `brew install ffmpeg`
  - Windows: `choco install ffmpeg`
- **ImageMagick**: Image processing
  - Ubuntu/Debian: `sudo apt-get install imagemagick`
  - macOS: `brew install imagemagick`
  - Windows: `choco install imagemagick`

#### repomix
- **Node.js 18+**: https://nodejs.org/
- **Repomix**: `npm install -g repomix`

#### ui-styling
- **Node.js 18+**: https://nodejs.org/
- **pnpm**: `npm install -g pnpm`

## Installation by Platform

### Linux (Ubuntu/Debian)

```bash
# Python environment
python3 -m venv .venv
source .venv/bin/activate

# Python packages (media only)
cd .claude/skills/media/scripts
pip install -r requirements.txt

# System tools
sudo apt-get update
sudo apt-get install -y ffmpeg imagemagick

# Node.js and tools
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
npm install -g pnpm repomix
```

### macOS

```bash
# Python environment
python3 -m venv .venv
source .venv/bin/activate

# Python packages (media only)
cd .claude/skills/media/scripts
pip install -r requirements.txt

# System tools via Homebrew
brew install ffmpeg imagemagick

# Node.js and tools
brew install node
npm install -g pnpm repomix
```

### Windows

```powershell
# Python environment
python -m venv .venv
.venv\Scripts\activate

# Python packages (media only)
cd .claude\skills\media\scripts
pip install -r requirements.txt

# System tools via Chocolatey
choco install ffmpeg imagemagick nodejs

# Node.js tools
npm install -g pnpm repomix
```

## Testing Dependencies

All skills include test dependencies in `requirements.txt`:

```txt
pytest>=8.0.0
pytest-cov>=4.1.0
pytest-mock>=3.12.0
```

To run tests for a skill:

```bash
cd .claude/skills/{skill-name}/scripts
python -m pytest tests/ -v --cov=. --cov-report=term-missing
```

## Environment Variables

Skills respect environment variable loading priority:

1. **process.env** (highest priority - runtime environment)
2. **`.claude/skills/{skill-name}/.env`** (skill-specific config)
3. **`.claude/skills/.env`** (shared skills config)
4. **`.claude/.env`** (global Claude config)

Example `.env` files are provided where needed (e.g., `media/.env.example`).

## Troubleshooting

### "externally-managed-environment" Error

If you see this error when installing packages:

```bash
# Use virtual environment (recommended)
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Or use pipx for CLI tools
pipx install google-genai
```

### Missing System Tools

If scripts fail with "command not found":

```bash
# Check if tool is installed
which ffmpeg
which docker
which node

# Verify tool works
ffmpeg -version
docker --version
node --version
```

### Permission Errors

On Linux/macOS, you may need to make scripts executable:

```bash
chmod +x .claude/skills/*/scripts/*.py
```

## Minimal Installation

If you only want to use specific skills:

**For media only:**
```bash
pip install google-genai pypdf python-docx markdown Pillow python-dotenv
```

**For FFmpeg and ImageMagick only:**
```bash
# macOS
brew install ffmpeg imagemagick

# Linux
sudo apt-get install ffmpeg imagemagick

# Windows
choco install ffmpeg imagemagick
```

**For other skills:**
Most other skills (for example ui-styling) use only Python stdlib and require no `pip install`.

## Development Setup

For contributors working on skills:

```bash
# Install all test dependencies
pip install pytest pytest-cov pytest-mock

# Install pre-commit hooks (if available)
pre-commit install

# Run all tests
pytest .claude/skills/*/scripts/tests/ -v

# Check coverage across all skills
pytest .claude/skills/*/scripts/tests/ --cov=.claude/skills --cov-report=html
```

## Skill-Specific Notes

### media
- Requires `GEMINI_API_KEY` in environment
- Get API key: https://aistudio.google.com/app/apikey
- Windows users: `docx2pdf` requires Microsoft Word installed

## Getting Help

If dependencies fail to install or scripts don't work:

1. Check the skill's `scripts/requirements.txt` for specific versions
2. Verify system tools are installed and in PATH
3. Check environment variables are set correctly
4. Review skill's `SKILL.md` for additional setup instructions
5. Open an issue: https://github.com/anthropics/claude-code/issues
