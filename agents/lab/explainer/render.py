"""Runs the Remotion project in video/ (node render.mjs) and relays its progress."""
from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Callable

log = logging.getLogger("lab.explainer.render")

VIDEO_DIR = Path(os.environ.get("EXPLAINER_VIDEO_DIR", "") or Path(__file__).resolve().parents[3] / "video")
RENDER_TIMEOUT = int(os.environ.get("EXPLAINER_RENDER_TIMEOUT_SECONDS", "2400"))


class RenderError(Exception):
    pass


def check() -> str | None:
    """A reason the renderer cannot run, or None."""
    if not shutil.which("node"):
        return "Node.js is not installed (needed by Remotion to render the video)"
    if not (VIDEO_DIR / "render.mjs").exists():
        return f"the Remotion project was not found at {VIDEO_DIR}"
    if not (VIDEO_DIR / "node_modules" / "remotion").exists():
        return f"the Remotion project has no dependencies yet: run `npm install` in {VIDEO_DIR}"
    return None


def render(job_dir: Path, on_progress: Callable[[float, str], None]) -> Path:
    problem = check()
    if problem:
        raise RenderError(problem)
    cmd = [shutil.which("node") or "node", str(VIDEO_DIR / "render.mjs"), "--job", str(job_dir)]
    # stderr goes to a file: a full pipe would block the renderer.
    log_file = open(job_dir / "render.log", "w", encoding="utf-8")
    proc = subprocess.Popen(cmd, cwd=str(VIDEO_DIR), stdout=subprocess.PIPE, stderr=log_file, text=True,
                            encoding="utf-8", errors="replace")
    error = ""
    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                ev = json.loads(line)
            except ValueError:
                continue
            if ev.get("event") == "progress":
                on_progress(float(ev.get("progress") or 0), "")
            elif ev.get("event") == "stage":
                on_progress(-1, {"browser": "Preparing the renderer", "bundle": "Bundling the animation",
                                 "render": "Rendering frames"}.get(ev.get("stage"), ""))
            elif ev.get("event") == "error":
                error = ev.get("message", "")
        proc.wait(timeout=RENDER_TIMEOUT)
    except subprocess.TimeoutExpired:
        proc.kill()
        raise RenderError(f"rendering took longer than {RENDER_TIMEOUT} s")
    finally:
        log_file.close()
    if proc.returncode != 0:
        stderr = (job_dir / "render.log").read_text(encoding="utf-8", errors="replace")[-1500:]
        raise RenderError((error or stderr or f"renderer exited with code {proc.returncode}")[:2000])
    out = job_dir / "video.mp4"
    if not out.exists():
        raise RenderError("the renderer finished without writing video.mp4")
    return out
