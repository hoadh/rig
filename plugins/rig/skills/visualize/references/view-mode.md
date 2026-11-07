# View Mode

## Execution

**IMPORTANT:** Run server as Claude Code background task using `run_in_background: true` with the Bash tool.

The skill dir is printed by `rig-skill-dir markdown-viewer`; start the server with `rig-markdown-viewer`.

### Stop Server

If `--stop` flag is provided:

```bash
rig-markdown-viewer --stop
```

### Start Server

Run the `markdown-viewer` server as CC background task with `--foreground` flag:

```bash
INPUT_PATH="<resolved-path>"
if [[ -d "$INPUT_PATH" ]]; then
  rig-markdown-viewer \
    --dir "$INPUT_PATH" --host 0.0.0.0 --open --foreground
else
  rig-markdown-viewer \
    --file "$INPUT_PATH" --host 0.0.0.0 --open --foreground
fi
```

**Critical:** When calling the Bash tool:
- Set `run_in_background: true`
- Set `timeout: 300000` (5 minutes)
- Parse JSON output and report URL to user

After starting, report:
- Local URL for browser access
- Network URL for remote device access
- Inform user that server is now running as CC background task (visible in `/tasks`)

**CRITICAL:** MUST display the FULL URL including path and query string. NEVER truncate to just `host:port`.
