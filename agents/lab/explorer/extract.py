"""Per-paper facts for the timeline: category, methodology, contribution, limitations, future work, datasets, metrics.

Source of truth is each paper's ABSTRACT (full texts are not fetched). Quoted facts are verified against the abstract
(see evidence.py). With no AI provider configured, only metadata-derived fields are filled and everything else stays
"not reported": nothing is guessed.
"""
from __future__ import annotations

import json
import logging

from .. import llm
from .evidence import evidence_text, keep_verified

log = logging.getLogger("lab.explorer.extract")

BATCH = 5

SYSTEM = (
    "You extract facts from paper ABSTRACTS for a literature review. Use ONLY the abstract text given for each paper. "
    "Never use outside knowledge and never guess. For every limitation, future-work item, dataset and metric you list, "
    "copy a short exact quote (at least 8 words) from that abstract into 'quote'. If the abstract does not state something, "
    "return an empty list for it. 'contribution' is one plain sentence summarising the main contribution; 'methodology' is "
    "2-4 short tags (e.g. 'knowledge distillation', 'convolutional network'); 'category' is a short research category "
    'such as "model compression", "optimisation", "benchmark/dataset", "survey", "application". '
    'Return JSON: {"papers":[{"id":"...","category":"","methodology":[],"contribution":"","limitations":[{"text":"","quote":""}],'
    '"future_work":[{"text":"","quote":""}],"datasets":[{"name":"","quote":""}],"metrics":[{"name":"","value":"","quote":""}]}]}'
)


def _empty() -> dict:
    return {"category": None, "methodology": [], "contribution": None, "limitations": [], "future_work": [], "datasets": [], "metrics": [], "extracted_by": None}


def extract_all(papers: list[dict], warnings: list[str], progress=None) -> None:
    """Fills paper['facts'] in place."""
    for p in papers:
        p["facts"] = _empty()
        # Category from source metadata (not AI): fields of study / OpenAlex topics.
        if p.get("fields"):
            p["facts"]["category"] = p["fields"][0]
            p["facts"]["category_source"] = "source metadata"
    todo = [p for p in papers if evidence_text(p)]
    if not llm.available():
        if papers:
            warnings.append("No AI provider is configured, so limitations, contributions, comparisons and gaps could not be extracted. Add a Groq or Gemini key.")
        return
    for i in range(0, len(todo), BATCH):
        chunk = todo[i:i + BATCH]
        if progress:
            progress(f"Reading abstracts {i + 1}-{i + len(chunk)} of {len(todo)}")
        payload = [{"id": p["id"], "title": p["title"], "abstract": (p.get("abstract") or "")[:2500]} for p in chunk]
        data, _ = llm.chat_json("fast", SYSTEM, json.dumps(payload, ensure_ascii=False), max_tokens=3500, agent="research_b")
        rows = data.get("papers") if isinstance(data, dict) else None
        if not isinstance(rows, list):
            warnings.append(f"The AI could not read {len(chunk)} abstracts in one batch; those papers show metadata only.")
            continue
        by_id = {r.get("id"): r for r in rows if isinstance(r, dict)}
        for p in chunk:
            r = by_id.get(p["id"])
            if not r:
                continue
            text = evidence_text(p)
            f = p["facts"]
            f["methodology"] = [str(m)[:60] for m in (r.get("methodology") or []) if isinstance(m, str)][:4]
            f["contribution"] = (r.get("contribution") or "").strip()[:400] or None
            f["limitations"] = keep_verified(r.get("limitations"), text)[:5]
            f["future_work"] = keep_verified(r.get("future_work"), text)[:5]
            f["datasets"] = keep_verified(r.get("datasets"), text)[:6]
            f["metrics"] = keep_verified(r.get("metrics"), text)[:6]
            if not f.get("category") and isinstance(r.get("category"), str):
                f["category"] = r["category"].strip()[:60] or None
                f["category_source"] = "AI, from the abstract"
            f["extracted_by"] = "ai"
