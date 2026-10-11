"""ElevenLabs text-to-speech, one clip per scene, cached on disk so a rerun costs nothing.

Endpoint (checked against the official docs, elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps):
  POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps?output_format=mp3_44100_128
  header xi-api-key; body {text, model_id, voice_settings, previous_text, next_text}
  -> {audio_base64, alignment: {characters, character_start_times_seconds, character_end_times_seconds}, ...}

Keys come only from the environment: ELEVENLABS_API_KEYS (comma separated, rotated when one is out of credits or
rejected) and/or ELEVENLABS_API_KEY. A key is never logged or stored.
"""
from __future__ import annotations

import array
import base64
import hashlib
import json
import logging
import math
import os
import re
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import httpx

from ..config import settings

log = logging.getLogger("lab.explainer.voice")

API = "https://api.elevenlabs.io/v1/text-to-speech/{voice}/with-timestamps"
OUTPUT_FORMAT = "mp3_44100_128"
VOICE_SETTINGS = {"stability": 0.5, "similarity_boost": 0.75, "style": 0.0, "use_speaker_boost": True, "speed": 1.0}
CACHE_DIR = settings.data_dir / "explainer_cache" / "tts"

# Premade voices offered in the UI (any voice id from the account works).
VOICES = {
    "XrExE9yKIg1WjnnlVkGX": "Matilda · warm, professional",
    "Xb7hH8MSUJpSbSDYk0k2": "Alice · clear British educator",
    "onwK4e9ZLuTAKqWW03F9": "Daniel · steady British broadcaster",
    "cjVigY5qzO86Huf0OWal": "Eric · smooth, trustworthy",
    "SAz9YHcvj6GT2YYXdXww": "River · relaxed, neutral",
}


def _keys() -> list[str]:
    raw = os.environ.get("ELEVENLABS_API_KEYS", "") + "," + os.environ.get("ELEVENLABS_API_KEY", "")
    out: list[str] = []
    for k in (x.strip() for x in raw.split(",")):
        if k and k not in out:
            out.append(k)
    return out


def default_voice() -> str:
    return os.environ.get("ELEVENLABS_VOICE_ID", "").strip() or "XrExE9yKIg1WjnnlVkGX"


def default_model() -> str:
    return os.environ.get("ELEVENLABS_MODEL_ID", "").strip() or "eleven_flash_v2_5"


def configured() -> bool:
    return bool(_keys())


class VoiceError(Exception):
    pass


_dead: dict[str, float] = {}   # key -> time it was set aside (out of credits / rejected)
_dead_lock = threading.Lock()
_http = httpx.Client(timeout=httpx.Timeout(20.0, read=120.0))


@dataclass
class Clip:
    path: Path
    alignment: dict
    duration: float
    cached: bool
    characters: int


def _redact(text: str) -> str:
    for k in _keys():
        text = text.replace(k, "[key]")
    return re.sub(r"sk_[A-Za-z0-9]{12,}", "[key]", text)


def synthesize(text: str, voice_id: str, model_id: str, previous_text: str = "", next_text: str = "") -> Clip:
    payload = {"text": text, "model_id": model_id, "voice_settings": VOICE_SETTINGS}
    if previous_text:
        payload["previous_text"] = previous_text[-600:]
    if next_text:
        payload["next_text"] = next_text[:600]
    h = hashlib.sha256(json.dumps({"v": voice_id, "f": OUTPUT_FORMAT, **payload}, sort_keys=True).encode()).hexdigest()[:32]
    mp3, meta = CACHE_DIR / f"{h}.mp3", CACHE_DIR / f"{h}.json"
    if mp3.exists() and meta.exists():
        info = json.loads(meta.read_text(encoding="utf-8"))
        return Clip(mp3, info["alignment"], info["duration"], True, 0)

    keys = _keys()
    if not keys:
        raise VoiceError("ElevenLabs is not configured: set ELEVENLABS_API_KEYS (or ELEVENLABS_API_KEY) in .env")
    errors: list[str] = []
    with _dead_lock:
        now = time.time()
        usable = [k for k in keys if now - _dead.get(k, 0) > 1800] or keys
    for i, key in enumerate(usable):
        for attempt in range(3):
            try:
                r = _http.post(API.format(voice=voice_id), params={"output_format": OUTPUT_FORMAT},
                               headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "application/json"}, json=payload)
            except httpx.HTTPError as e:
                errors.append(f"key {i + 1}: network error {type(e).__name__}")
                time.sleep(2 * (attempt + 1))
                continue
            if r.status_code == 200:
                data = r.json()
                audio = base64.b64decode(data["audio_base64"])
                align = data.get("alignment") or data.get("normalized_alignment") or {}
                CACHE_DIR.mkdir(parents=True, exist_ok=True)
                tmp = mp3.with_suffix(".part")
                tmp.write_bytes(audio)
                tmp.replace(mp3)
                dur = _probe_duration(mp3) or (align.get("character_end_times_seconds") or [0.0])[-1]
                meta.write_text(json.dumps({"alignment": align, "duration": dur, "voice": voice_id, "model": model_id, "text": text}), encoding="utf-8")
                return Clip(mp3, align, dur, False, len(text))
            detail = ""
            try:
                d = r.json().get("detail")
                detail = (d.get("status") or d.get("code") or "") + ": " + (d.get("message") or "") if isinstance(d, dict) else str(d)
            except ValueError:
                detail = r.text[:200]
            detail = _redact(detail)[:240]
            if r.status_code == 429 and "quota" not in detail and attempt < 2:  # concurrency / rate limit: wait and retry this key
                time.sleep(3 * (attempt + 1))
                continue
            errors.append(f"key {i + 1}: HTTP {r.status_code} {detail}")
            if r.status_code in (401, 402, 403) or "quota" in detail or "credits" in detail:
                with _dead_lock:
                    _dead[key] = time.time()
            if r.status_code in (400, 404, 422) and "quota" not in detail:
                raise VoiceError(f"ElevenLabs refused the request: HTTP {r.status_code} {detail}")
            break
    raise VoiceError("ElevenLabs failed on every key: " + "; ".join(errors[-4:]))


# ---------- audio analysis ----------

def ffmpeg_bin(name: str = "ffmpeg") -> str | None:
    return shutil.which(name)


def _probe_duration(p: Path) -> float:
    exe = ffmpeg_bin("ffprobe")
    if not exe:
        return 0.0
    try:
        out = subprocess.run([exe, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(p)],
                             capture_output=True, text=True, timeout=30)
        return float(out.stdout.strip() or 0)
    except (OSError, ValueError, subprocess.SubprocessError):
        return 0.0


def mouth_curve(clip: Clip, fps: int, frames: int) -> list[float]:
    """Mouth openness per frame (0..1) from the clip's loudness; falls back to the character timings without ffmpeg."""
    exe = ffmpeg_bin()
    if exe:
        try:
            rate = 16000
            raw = subprocess.run([exe, "-v", "error", "-i", str(clip.path), "-f", "s16le", "-ac", "1", "-ar", str(rate), "-"],
                                 capture_output=True, timeout=60, check=True).stdout
            samples = array.array("h")
            samples.frombytes(raw[: len(raw) // 2 * 2])
            per = rate / fps
            rms = []
            for f in range(frames):
                seg = samples[int(f * per): int((f + 1) * per)]
                rms.append(math.sqrt(sum(x * x for x in seg) / len(seg)) if len(seg) else 0.0)
            ref = sorted(rms)[int(len(rms) * 0.95)] if rms else 1.0
            ref = ref or 1.0
            out = []
            for v in rms:
                x = min(1.0, (v / ref)) ** 0.75
                out.append(round(0.0 if x < 0.12 else x, 3))
            return out
        except (OSError, subprocess.SubprocessError) as e:
            log.warning("could not analyse audio loudness (%s); using character timings", e)
    chars = clip.alignment.get("characters") or []
    starts = clip.alignment.get("character_start_times_seconds") or []
    ends = clip.alignment.get("character_end_times_seconds") or []
    out = [0.0] * frames
    for ch, s, e in zip(chars, starts, ends):
        if not ch.strip():
            continue
        v = 0.85 if ch.lower() in "aeiou" else 0.45
        for f in range(int(s * fps), min(frames, int(e * fps) + 1)):
            out[f] = max(out[f], v)
    return out


def cue_frame(clip: Clip, narration: str, cue: str, fps: int) -> int | None:
    """Frame at which the narration reaches `cue` (a few words copied from it)."""
    cue = re.sub(r"\s+", " ", (cue or "")).strip().lower().strip(".,;:!?\"'")
    if len(cue) < 3:
        return None
    text = "".join(clip.alignment.get("characters") or []) or narration
    idx = text.lower().find(cue)
    if idx < 0:  # try the first three words only
        short = " ".join(cue.split()[:3])
        idx = text.lower().find(short) if len(short) >= 3 else -1
    starts = clip.alignment.get("character_start_times_seconds") or []
    if idx < 0 or idx >= len(starts):
        return None
    return int(starts[idx] * fps)
