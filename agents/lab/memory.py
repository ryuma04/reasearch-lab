"""Lab Memory (Hero 6): error fixes, settings, experiments and agent skills, searchable by meaning.

Embeddings: FastEmbed BGE-small (384-d) when installed, otherwise a deterministic hashing
embedding of the same size, so pgvector search always works offline.
"""
from __future__ import annotations

import hashlib
import logging
import math
import re
import threading

from . import db

log = logging.getLogger("lab.memory")

DIM = 384
_embedder = None
_embedder_name = "hashing-384"
_lock = threading.Lock()


def _load_embedder():
    global _embedder, _embedder_name
    if _embedder is not None:
        return _embedder
    with _lock:
        if _embedder is None:
            try:
                from fastembed import TextEmbedding  # type: ignore

                _embedder = TextEmbedding("BAAI/bge-small-en-v1.5")
                _embedder_name = "bge-small-en-v1.5"
            except Exception as e:  # noqa: BLE001
                log.info("fastembed unavailable (%s); using hashing embeddings", e)
                _embedder = False
    return _embedder


def embedder_name() -> str:
    _load_embedder()
    return _embedder_name


def _hash_embed(text: str) -> list[float]:
    vec = [0.0] * DIM
    tokens = re.findall(r"[a-z0-9_]+", text.lower())
    grams = tokens + [a + " " + b for a, b in zip(tokens, tokens[1:])]
    for g in grams:
        h = int.from_bytes(hashlib.blake2b(g.encode(), digest_size=8).digest(), "little")
        vec[h % DIM] += 1.0 if (h >> 63) & 1 else -1.0
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def embed(text: str) -> list[float]:
    e = _load_embedder()
    if e:
        try:
            return [float(x) for x in next(iter(e.embed([text])))]
        except Exception as ex:  # noqa: BLE001
            log.warning("embedding failed: %s", ex)
    return _hash_embed(text)


def _vec(v: list[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in v) + "]"


def add(kind: str, text: str, details: dict, source_run_id: int | None = None) -> int:
    details = {**details, "embedder": embedder_name()}
    return db.scalar(
        "INSERT INTO memory_items (kind, text, details, embedding, source_run_id) VALUES (%s,%s,%s,%s::vector,%s) RETURNING id",
        (kind, text, db.J(details), _vec(embed(text)), source_run_id))


def search(query: str, kind: str = "", limit: int = 10) -> list[dict]:
    if not query.strip():
        return db.q("""SELECT id, kind, text, details, times_used, success_rate, source_run_id, created_at
                       FROM memory_items WHERE (%s = '' OR kind = %s) ORDER BY id DESC LIMIT %s""", (kind, kind, limit))
    return db.q("""
        SELECT id, kind, text, details, times_used, success_rate, source_run_id, created_at,
               round((1 - (embedding <=> %s::vector))::numeric, 4) AS similarity
        FROM memory_items WHERE (%s = '' OR kind = %s) AND embedding IS NOT NULL
        ORDER BY embedding <=> %s::vector LIMIT %s""",
        (_vec(embed(query)), kind, kind, _vec(embed(query)), limit))


def mark_used(item_id: int, success: bool) -> None:
    db.ex("""UPDATE memory_items SET times_used = times_used + 1,
                    times_succeeded = times_succeeded + %s,
                    success_rate = (times_succeeded + %s)::float8 / (times_used + 1)
             WHERE id = %s""", (1 if success else 0, 1 if success else 0, item_id))


# ---------- error memory ----------

_PATH = re.compile(r"(/[\w.\-]+)+|([A-Za-z]:\\[^\s]+)")
_NUM = re.compile(r"\b0x[0-9a-f]+\b|\b\d+\b")


def error_signature(log_tail: str) -> str:
    """A stable signature of an error: the last exception line, without paths and numbers."""
    lines = [l.strip() for l in log_tail.strip().splitlines() if l.strip()]
    key = ""
    for l in reversed(lines):
        if re.match(r"^[\w.]+(Error|Exception|Exit|Interrupt)\b", l) or "error:" in l.lower() or l.startswith("E "):
            key = l
            break
    if not key and lines:
        key = lines[-1]
    key = _PATH.sub("<path>", key)
    key = _NUM.sub("<n>", key)
    return key[:300]


def find_fix(log_tail: str) -> dict | None:
    """Known fix for this error: exact signature first, then a close meaning match."""
    sig = error_signature(log_tail)
    if not sig:
        return None
    row = db.q1("""SELECT id, text, details, times_used, success_rate, source_run_id FROM memory_items
                   WHERE kind='error_fix' AND details->>'signature' = %s
                   ORDER BY success_rate DESC, times_used DESC LIMIT 1""", (sig,))
    if row and (row["times_used"] == 0 or row["success_rate"] > 0):
        return row
    for cand in search(sig, "error_fix", 3):
        if cand.get("similarity", 0) >= 0.85 and (cand["times_used"] == 0 or cand["success_rate"] > 0):
            return cand
    return None


def save_fix(log_tail: str, ops: list[dict], description: str, run_id: int) -> int | None:
    sig = error_signature(log_tail)
    if not sig or not ops:
        return None
    existing = db.q1("SELECT id FROM memory_items WHERE kind='error_fix' AND details->>'signature'=%s", (sig,))
    if existing:
        return existing["id"]
    item_id = add("error_fix", f"{sig} -> {description}", {"signature": sig, "ops": ops, "description": description}, run_id)
    # A fix that was just proven to work counts as one successful use.
    db.ex("UPDATE memory_items SET times_used=1, times_succeeded=1, success_rate=1 WHERE id=%s", (item_id,))
    return item_id
