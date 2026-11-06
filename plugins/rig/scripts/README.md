# Claude Code Scripts

Centralized utility scripts for Claude Code skills.

## Installation

Install required dependencies:

```bash
pip install -r requirements.txt
```

## resolve_env.py

Centralized environment variable resolver that follows Claude Code's hierarchy.

### Priority Order (Highest to Lowest)

1. **process.env** - Runtime environment variables (HIGHEST)
2. **PROJECT/.claude/skills/\<skill\>/.env** - Project skill-specific
3. **PROJECT/.claude/skills/.env** - Project shared across skills
4. **PROJECT/.claude/.env** - Project global defaults
5. **~/.claude/skills/\<skill\>/.env** - User skill-specific
6. **~/.claude/skills/.env** - User shared across skills
7. **~/.claude/.env** - User global defaults (LOWEST)

### CLI Usage

```bash
# Resolve a variable for a specific skill
python ~/.claude/scripts/resolve_env.py GEMINI_API_KEY --skill media

# With verbose output
python ~/.claude/scripts/resolve_env.py GEMINI_API_KEY --skill media --verbose

# Find all locations where variable is defined
python ~/.claude/scripts/resolve_env.py GEMINI_API_KEY --find-all

# Show hierarchy for a skill
python ~/.claude/scripts/resolve_env.py --show-hierarchy --skill media

# Export format for shell sourcing
eval $(python ~/.claude/scripts/resolve_env.py GEMINI_API_KEY --export)
```

### Python API Usage

```python
# Add to sys.path if needed
import sys
from pathlib import Path
sys.path.insert(0, str(Path.home() / '.claude' / 'scripts'))

from resolve_env import resolve_env, find_all, show_hierarchy

# Simple resolution
api_key = resolve_env('GEMINI_API_KEY', skill='media')

# With default value
api_key = resolve_env('GEMINI_API_KEY', skill='media', default='fallback-key')

# With verbose output
api_key = resolve_env('GEMINI_API_KEY', skill='media', verbose=True)

# Find all locations
locations = find_all('GEMINI_API_KEY', skill='media')
for description, value, path in locations:
    print(f"{description}: {value}")

# Show hierarchy
show_hierarchy(skill='media')
```

### Integration Pattern

Skills should use this script instead of implementing their own resolution logic:

```python
#!/usr/bin/env python3
import sys
from pathlib import Path

# Import centralized resolver
sys.path.insert(0, str(Path.home() / '.claude' / 'scripts'))
from resolve_env import resolve_env

# Resolve API key
api_key = resolve_env('GEMINI_API_KEY', skill='media')

if not api_key:
    print("Error: GEMINI_API_KEY not found")
    print("Run: python ~/.claude/scripts/resolve_env.py --show-hierarchy --skill media")
    sys.exit(1)

# Use api_key...
```

### Benefits

- **Consistent**: All skills use the same resolution logic
- **Maintainable**: Single source of truth for hierarchy
- **Debuggable**: Built-in verbose mode and find-all functionality
- **Flexible**: Supports both project-local and user-global configs
- **Clear**: Shows exactly where each value comes from

### Testing

```bash
# Test without any config files
python ~/.claude/scripts/resolve_env.py TEST_VAR --verbose

# Test with environment variable
export TEST_VAR=from-runtime
python ~/.claude/scripts/resolve_env.py TEST_VAR --verbose

# Test with skill context
python ~/.claude/scripts/resolve_env.py GEMINI_API_KEY --skill media --find-all
```

## Docs layout scripts

Diataxis docs layout used by `/rig:docs` (see `.claude/skills/docs/references/diataxis-docs-layout.md`).

| Script | Purpose |
|--------|---------|
| `docs-diataxis-layout.cjs` | Legacy → Diataxis path map + layout helpers (single source of truth) |
| `migrate-docs-to-diataxis-layout.cjs [docs-dir] [--map <from>=<to> ...] [--apply]` | Dry-run by default; `--apply` moves files (`git mv`) and rewrites links. `--map` adds custom moves (used by `/rig:docs restructure`) |
| `migrate-docs-custom-move-map-parser.cjs` | Parses and validates `--map` values (relative paths, target under a Diataxis dir or `project/`) |
| `validate-docs.cjs [docs-dir]` | Recursive link/code-ref check + layout warnings (non-blocking) |

Tests: `node --test .claude/scripts/*.test.cjs`
