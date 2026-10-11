"""Paper-to-Video Explainer job (worker job type "explainer_video").

  1. extracting  read the PDF: text, figure/table crops, equation crops (+ exact LaTeX from the arXiv source if any)
  2. scripting   LLM scene script, fact-checked against the paper (cached per PDF, so a rerun reuses it)
  3. voicing     one ElevenLabs clip per scene (cached on disk, so a rerun costs nothing)
  4. rendering   Remotion renders the MP4; each scene lasts as long as its clip

Files: DATA_DIR/workspaces/{ws}/explainer/{id}/ with script.json, report.json, props.json, public/ and video.mp4.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import re
import shutil
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx

from .. import db
from ..config import settings
from . import extract, render, script as scriptmod, voice

log = logging.getLogger("lab.explainer")

FPS = 30
TAIL = 0.35            # seconds of breathing room after each clip
SCRIPT_VERSION = "v1"  # bump when the prompt or the checks change, so cached scripts are rewritten
CACHE = settings.data_dir / "explainer_cache"
HTTP = httpx.Client(timeout=httpx.Timeout(15.0, read=90.0), follow_redirects=True,
                    headers={"User-Agent": "tapu-sena-research-lab/1.0 (paper explainer)"})


def _set(video_id: int, **fields) -> None:
    cols = ", ".join(f"{k}=%s" for k in fields) + ", updated_at=now()"
    vals = [db.J(v) if isinstance(v, (dict, list)) else v for v in fields.values()]
    db.ex(f"UPDATE explainer_videos SET {cols} WHERE id=%s", (*vals, video_id))


def job_dir(workspace_id: int, video_id: int) -> Path:
    return settings.data_dir / "workspaces" / str(workspace_id) / "explainer" / str(video_id)


# ---------- inputs ----------

def _arxiv_pdf(arxiv_id: str) -> Path:
    p = CACHE / "arxiv" / f"{arxiv_id.replace('/', '_')}.pdf"
    if not p.exists():
        r = HTTP.get(f"https://arxiv.org/pdf/{arxiv_id}")
        r.raise_for_status()
        if not r.content.startswith(b"%PDF-"):
            raise RuntimeError(f"arXiv did not return a PDF for {arxiv_id}")
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(r.content)
    return p


def _latex_source(arxiv_id: str) -> str:
    if not arxiv_id:
        return ""
    p = CACHE / "latex" / f"{arxiv_id.replace('/', '_')}.tex.txt"
    if p.exists():
        return p.read_text(encoding="utf-8", errors="ignore")
    try:
        from ..research import _arxiv_latex  # same downloader the Paper Reader uses
        src = _arxiv_latex(arxiv_id)
    except Exception as e:  # noqa: BLE001 - the video still works with equation crops
        log.warning("arXiv source for %s not available: %s", arxiv_id, e)
        src = ""
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(src, encoding="utf-8")
    return src


def _paper_pdf(row: dict) -> tuple[Path, str]:
    """(pdf path, arXiv id or '') of the upload this video is about."""
    up = db.q1("SELECT * FROM uploads WHERE id=%s AND workspace_id=%s AND kind='paper'", (row["upload_id"], row["workspace_id"]))
    if not up:
        raise RuntimeError("the paper upload no longer exists")
    url = up["path_or_url"]
    m = re.search(r"arxiv\.org/abs/([^\s?#]+)", url)
    if m:
        paper = db.q1("SELECT pdf_path FROM papers WHERE upload_id=%s", (up["id"],))
        if paper and paper["pdf_path"] and (settings.data_dir / paper["pdf_path"]).exists():
            return settings.data_dir / paper["pdf_path"], m.group(1)
        return _arxiv_pdf(m.group(1)), m.group(1)
    p = (settings.data_dir / url).resolve()
    if settings.data_dir not in p.parents or not p.exists():
        raise RuntimeError("the uploaded PDF file is missing")
    return p, ""


# ---------- props for the Remotion composition ----------

def _spread(n: int, frames: int, start: float = 0.3, end: float = 0.82) -> list[int]:
    if n <= 0:
        return []
    return [int(frames * (start + (end - start) * (i / max(1, n - 1) if n > 1 else 0))) for i in range(n)]


def _scene_props(i: int, s: dict, clip: voice.Clip, audio_rel: str, paper: extract.PaperContent) -> dict:
    frames = max(FPS, math.ceil((clip.duration + TAIL) * FPS))
    clamp = lambda f, lo=8: max(lo, min(frames - 20, f))  # noqa: E731
    figs = {f.id: f for f in paper.figures}
    eqs = {e.id: e for e in paper.equations}
    vis_at = voice.cue_frame(clip, s["narration"], s.get("visual_cue", ""), FPS)
    vis_at = clamp(vis_at if vis_at is not None else int(frames * 0.12))
    visual: dict = {"layout": "title" if s["kind"] == "intro" else "points", "points": []}
    if s.get("equation_id") in eqs:
        e = eqs[s["equation_id"]]
        visual.update(layout="equation", equation={"latex": e.latex or None, "image": e.file, "aspect": e.aspect, "label": e.label, "at": vis_at})
    elif s.get("figure_id") in figs:
        f = figs[s["figure_id"]]
        visual.update(layout="figure", figure={"src": f.file, "caption": f.caption, "aspect": f.aspect, "label": f.label, "at": vis_at})
    items = [(p["text"], False, None, p.get("cue", "")) for p in s.get("points", [])] + \
            [(q["text"], True, q["page"], q.get("cue", "")) for q in s.get("quotes", [])]
    if visual["layout"] in ("equation", "figure"):
        items = items[:2]  # the media takes most of the card
    if visual["layout"] == "title":
        items = []
    fallback = _spread(len(items), frames, 0.3 if visual["layout"] == "points" else 0.45)
    pts = []
    last = 0
    for k, (text, quote, page, cue) in enumerate(items):
        at = voice.cue_frame(clip, s["narration"], cue, FPS)
        at = clamp(at if at is not None else fallback[k])
        at = max(at, last + 10)  # keep the reading order
        last = at
        pts.append({"text": text, "quote": quote, "page": page, "at": at})
    visual["points"] = pts
    mouth = voice.mouth_curve(clip, FPS, frames)
    return {"id": f"s{i + 1}", "kind": s["kind"], "kicker": s["kicker"], "heading": s["heading"], "narration": s["narration"],
            "pose": s["pose"], "expression": s["expression"], "audio": audio_rel, "durationInFrames": frames, "mouth": mouth, "visual": visual}


# ---------- the job ----------

def run(video_id: int) -> None:
    row = db.q1("SELECT * FROM explainer_videos WHERE id=%s", (video_id,))
    if not row:
        log.warning("explainer video %s not found", video_id)
        return
    if row["status"] == "ready":
        return
    d = job_dir(row["workspace_id"], video_id)
    public = d / "public"
    try:
        _set(video_id, status="extracting", progress=0.03, message="Reading the paper: text, figures and equations", error="")
        pdf, arxiv_id = _paper_pdf(row)
        if public.exists():
            shutil.rmtree(public)
        public.mkdir(parents=True, exist_ok=True)
        paper = extract.extract(pdf, public)
        arxiv_id = arxiv_id or paper.arxiv_id  # an uploaded PDF often carries its arXiv stamp on page 1
        paper.arxiv_id = arxiv_id
        latex = _latex_source(arxiv_id) if arxiv_id else ""
        if latex:
            extract.attach_latex(paper, latex)
        (d / "paper.json").write_text(json.dumps(paper.to_dict(), indent=2, ensure_ascii=False), encoding="utf-8")
        _set(video_id, progress=0.12, paper_title=paper.title[:500],
             message=f"Found {len(paper.pages)} pages, {len(paper.figures)} figures/tables, {len(paper.equations)} equations")

        # 2. script (reused for the same PDF unless a fresh one was asked for)
        _set(video_id, status="scripting", progress=0.15, message="Writing the scene script and checking it against the paper")
        pdf_hash = hashlib.sha256(pdf.read_bytes()).hexdigest()[:24]
        cached = CACHE / "scripts" / f"{pdf_hash}-{SCRIPT_VERSION}.json"
        if cached.exists() and not row["fresh_script"]:
            saved = json.loads(cached.read_text(encoding="utf-8"))
            script, report = saved["script"], {**saved["report"], "script_cached": True}
        else:
            script, report = scriptmod.write(paper)
            cached.parent.mkdir(parents=True, exist_ok=True)
            cached.write_text(json.dumps({"script": script, "report": report}, ensure_ascii=False), encoding="utf-8")
            report["script_cached"] = False
        (d / "script.json").write_text(json.dumps(script, indent=2, ensure_ascii=False), encoding="utf-8")
        _set(video_id, script=script, report=report, progress=0.3,
             message=f"Script ready: {report['scene_count']} scenes, {report['word_count']} words")

        # 3. voice
        voice_id = row["voice_id"] or voice.default_voice()
        model_id = voice.default_model()
        _set(video_id, status="voicing", progress=0.32, message="Recording the voiceover with ElevenLabs")
        chars, hits = 0, 0
        n = len(script["scenes"])
        (public / "audio").mkdir(parents=True, exist_ok=True)

        # Synthesize all scenes in parallel: the ElevenLabs HTTP round-trips are the
        # main bottleneck (~15-20 s each).  prev_text / next_text are prosody hints
        # derived from the already-known narration strings, so every call is independent
        # and thread-safe (voice.synthesize uses httpx.Client + atomic file caching).
        def _synth(idx: int):
            s = script["scenes"][idx]
            prev_t = script["scenes"][idx - 1]["narration"] if idx else ""
            next_t = script["scenes"][idx + 1]["narration"] if idx + 1 < n else ""
            return idx, voice.synthesize(s["narration"], voice_id, model_id, prev_t, next_t)

        clips = [None] * n
        with ThreadPoolExecutor(max_workers=min(3, n)) as pool:
            futs = [pool.submit(_synth, i) for i in range(n)]
            done_count = 0
            for fut in as_completed(futs):
                idx, clip = fut.result()
                clips[idx] = clip
                done_count += 1
                _set(video_id, progress=0.32 + 0.33 * done_count / n,
                     message=f"Voiced {done_count} of {n} scenes" + (" (from cache)" if clip.cached else ""))

        scenes = []
        for i, s in enumerate(script["scenes"]):
            clip = clips[i]
            chars += clip.characters
            hits += clip.cached
            rel = f"audio/scene-{i + 1}.mp3"
            shutil.copyfile(clip.path, public / rel)
            scenes.append(_scene_props(i, s, clip, rel, paper))
        report.update(tts={"voice_id": voice_id, "model_id": model_id, "characters_billed": chars, "clips_from_cache": hits, "clips": n})
        props = {"title": script["title"] or paper.title, "authors": script.get("authors", ""),
                 "source": f"arXiv:{arxiv_id}" if arxiv_id else (pdf.name.split("_", 1)[-1] if "_" in pdf.name else pdf.name),
                 "macros": paper.macros, "scenes": scenes}
        (d / "props.json").write_text(json.dumps(props, ensure_ascii=False), encoding="utf-8")
        duration = sum(s["durationInFrames"] for s in scenes) / FPS
        report["duration_seconds"] = round(duration, 1)

        # 4. render
        _set(video_id, status="rendering", progress=0.66, report=report, message=f"Rendering {duration / 60:.1f} minutes of video")

        def progress(p: float, msg: str) -> None:
            if p < 0:
                _set(video_id, message=msg)
            elif int(p * 100) % 5 == 0:
                _set(video_id, progress=0.68 + 0.31 * p, message=f"Rendering frames ({int(p * 100)}%)")

        out = render.render(d, progress)
        rel = out.relative_to(settings.data_dir).as_posix()
        _set(video_id, status="ready", progress=1.0, video_path=rel, duration_seconds=duration, report=report,
             message=f"Done: {duration / 60:.1f} minute video")
        log.info("explainer video %s ready (%s)", video_id, rel)
    except Exception as e:  # noqa: BLE001
        log.exception("explainer video %s failed", video_id)
        msg = voice._redact(str(e))[:1500]
        _set(video_id, status="failed", error=msg, message="Failed")
