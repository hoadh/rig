# Runtime Awareness

Watch usage limits and context window utilization during a Claude Code session.

## Overview

Two signals, both shown by the Rig statusline (`.agent/statusline.cjs`):
1. **Usage limits** - 5-hour rolling window (subscription plans only)
2. **Context window** - % of the context window in use

Nothing is injected into prompts. The model sees these numbers only if the user mentions them
or a skill reads the context file below.

## Source: statusline stdin

Claude Code pipes a JSON object to the statusline command on every refresh. Rig reads:

```json
{
  "session_id": "abc123",
  "rate_limits": {
    "five_hour": { "used_percentage": 42, "resets_at": 1760630400 }
  },
  "context_window": {
    "context_window_size": 200000,
    "used_percentage": 37,
    "remaining_percentage": 63,
    "current_usage": {
      "input_tokens": 20000,
      "cache_creation_input_tokens": 30000,
      "cache_read_input_tokens": 24000
    }
  }
}
```

- `rate_limits` is absent for API-key users; the statusline then shows no usage segment.
- `resets_at` is epoch seconds.
- No API call, OAuth token or Keychain read is involved.

## Context file for scripts

The statusline also writes `<os tmpdir>/rig-context-<session_id>.json`:

```json
{ "percent": 37, "remaining": 63, "tokens": 74000, "size": 200000, "usage": { "...": "..." }, "timestamp": 1760630000000 }
```

Read it from a script when a decision depends on context pressure. It is refreshed whenever the
statusline redraws, so check `timestamp` before trusting it.

## Recommendations by Threshold

### Context Window

| Utilization | Action |
|-------------|--------|
| < 70% | Continue normally |
| 70-80% | Plan compaction strategy |
| 80-90% | Execute compaction |
| > 90% | Immediate compaction or session reset |

### Usage Limits (5-hour)

| Used | Action |
|------|--------|
| < 70% | Normal usage |
| 70-90% | Reduce parallelization, delegate to subagents |
| > 90% | Wait for reset or use lower-tier models |

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| No usage segment | API-key auth, or Claude Code too old to send `rate_limits` | Use a subscription login / update Claude Code |
| No context file | Statusline not configured | Check `statusLine` in settings.json points at `statusline.cjs` |
