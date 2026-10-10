"""Evidence discipline for the Research Gap Explorer.

The AI may summarise and propose, but anything it presents as a FACT about a paper (a limitation, a metric, a
capability that is implemented or not) must carry a quote that really appears in that paper's text. A quote that
cannot be found is discarded and the fact becomes "not reported". This is what keeps "evidence-backed" honest.
"""
from __future__ import annotations

import re

MIN_QUOTE = 18  # shorter quotes match too easily to count as evidence


def _norm(s: str) -> str:
    s = (s or "").lower()
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"').replace("–", "-").replace("—", "-")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9%.,:;()'\"/\- ]+", " ", s)).strip()


def valid_quote(text: str | None, quote: str | None) -> bool:
    """True when `quote` (after whitespace/case normalisation) appears verbatim in `text`."""
    if not text or not quote:
        return False
    q = _norm(quote).strip(" .\"'")
    return len(q) >= MIN_QUOTE and q in _norm(text)


def keep_verified(items: list | None, text: str | None, quote_key: str = "quote") -> list[dict]:
    """Keep only items (dicts) whose quote is found in `text`; mark them verified."""
    out = []
    for it in items or []:
        if isinstance(it, dict) and valid_quote(text, it.get(quote_key)):
            out.append({**it, "verified": True})
    return out


def evidence_text(paper: dict) -> str:
    """The text a paper's quotes are checked against: its abstract (plus, for the uploaded paper, the analysis the
    Research Agent already extracted)."""
    return "\n".join(x for x in [paper.get("abstract"), paper.get("analysis_text")] if x)
