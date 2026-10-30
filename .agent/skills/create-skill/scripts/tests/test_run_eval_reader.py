"""Tests for run_eval's portable stdout reader (replaces select.select on pipes).

Regression: select.select() on a subprocess pipe raised WinError 10093 on Windows.
These tests use real child processes and a fake `claude` on PATH, no mocks.

Run from the skill dir: python -m pytest scripts/tests
"""

import json
import subprocess
import sys
import textwrap
import time
from pathlib import Path

import pytest

SKILL_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(SKILL_DIR))

from scripts.run_eval import run_single_query, start_stdout_reader  # noqa: E402

# Fake claude: finds the temp command file run_eval created, then emits stream events.
FAKE_CLAUDE = textwrap.dedent(
    """
    import json, os, sys, time
    mode = os.environ["FAKE_CLAUDE_MODE"]
    name = next(p.stem for p in (__import__("pathlib").Path(".agent/commands")).glob("*-skill-*.md"))
    def emit(obj):
        sys.stdout.write(json.dumps(obj) + chr(10)); sys.stdout.flush()
    if mode == "trigger":
        emit({"type": "stream_event", "event": {"type": "content_block_start",
              "content_block": {"type": "tool_use", "name": "Skill"}}})
        time.sleep(0.5)
        emit({"type": "stream_event", "event": {"type": "content_block_delta",
              "delta": {"type": "input_json_delta", "partial_json": json.dumps({"skill": name})}}})
        time.sleep(8)  # still running: caller must return early, not wait for exit
    elif mode == "other_tool":
        emit({"type": "stream_event", "event": {"type": "content_block_start",
              "content_block": {"type": "tool_use", "name": "Bash"}}})
        time.sleep(8)
    elif mode == "record":
        # Save what arrived on stdin and argv, then finish normally.
        out = os.environ["FAKE_CLAUDE_OUT"]
        with open(out, "w", encoding="utf-8") as f:
            json.dump({"stdin": sys.stdin.read(), "argv": sys.argv[1:]}, f)
        emit({"type": "result"})
    elif mode == "silent":
        time.sleep(8)
    """
)


def _install_fake_claude(tmp_path: Path, monkeypatch, mode: str) -> None:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    fake_py = bin_dir / "fake_claude.py"
    fake_py.write_text(FAKE_CLAUDE)
    if sys.platform == "win32":
        (bin_dir / "claude.cmd").write_bytes(
            f'@echo off\r\n"{sys.executable}" "{fake_py}" %*\r\n'.encode()
        )
    else:
        launcher = bin_dir / "claude"
        launcher.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{fake_py}" "$@"\n')
        launcher.chmod(0o755)
    monkeypatch.setenv("PATH", f"{bin_dir}{__import__('os').pathsep}{__import__('os').environ['PATH']}")
    monkeypatch.setenv("FAKE_CLAUDE_MODE", mode)


def test_reader_delivers_chunks_incrementally_then_eof():
    code = (
        "import sys, time\n"
        "for i in range(3):\n"
        "    print(f'line{i}', flush=True); time.sleep(0.4)\n"
    )
    proc = subprocess.Popen([sys.executable, "-c", code], stdout=subprocess.PIPE)
    start = time.time()
    chunks = start_stdout_reader(proc.stdout)

    first = chunks.get(timeout=5)
    assert first is not None and b"line0" in first
    assert time.time() - start < 1.0, "first line must arrive before child finishes"

    data = first
    while True:
        item = chunks.get(timeout=5)
        if item is None:
            break
        data += item
    proc.wait(timeout=5)
    assert data.replace(b"\r\n", b"\n").split() == [b"line0", b"line1", b"line2"]


def test_reader_supports_get_timeout_when_child_is_silent():
    proc = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(3)"], stdout=subprocess.PIPE
    )
    try:
        chunks = start_stdout_reader(proc.stdout)
        import queue

        with pytest.raises(queue.Empty):
            chunks.get(timeout=0.5)
    finally:
        proc.kill()
        proc.wait()


def test_run_single_query_detects_trigger_early(tmp_path, monkeypatch):
    _install_fake_claude(tmp_path, monkeypatch, "trigger")
    start = time.time()
    triggered = run_single_query("q", "demo", "demo skill", 20, str(tmp_path))
    assert triggered is True
    assert time.time() - start < 7, "must return on the early event, not wait for exit"


def test_run_single_query_other_tool_is_not_trigger(tmp_path, monkeypatch):
    _install_fake_claude(tmp_path, monkeypatch, "other_tool")
    assert run_single_query("q", "demo", "demo skill", 20, str(tmp_path)) is False


def test_run_single_query_times_out_when_silent(tmp_path, monkeypatch):
    _install_fake_claude(tmp_path, monkeypatch, "silent")
    start = time.time()
    assert run_single_query("q", "demo", "demo skill", 2, str(tmp_path)) is False
    assert time.time() - start < 6


def test_query_with_cmd_metacharacters_is_not_executed_and_arrives_intact(tmp_path, monkeypatch):
    """C1 regression: query must travel via stdin, not argv (cmd.exe injection)."""
    marker = tmp_path / "marker.txt"
    out = tmp_path / "recorded.json"
    monkeypatch.setenv("FAKE_CLAUDE_OUT", str(out))
    _install_fake_claude(tmp_path, monkeypatch, "record")
    query = 'a" & echo PWNED>marker.txt & "'
    assert run_single_query(query, "demo", "demo skill", 20, str(tmp_path)) is False
    recorded = json.loads(out.read_text(encoding="utf-8"))
    assert recorded["stdin"] == query
    assert query not in recorded["argv"] and "a\"" not in " ".join(recorded["argv"])
    assert not marker.exists()
    assert not (tmp_path / "bin" / "marker.txt").exists()
