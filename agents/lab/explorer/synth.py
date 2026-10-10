"""System comparison, research gaps and improvement recommendations.

The AI proposes; the code verifies. Every comparison cell and every gap carries quotes that are checked against the
paper they are attributed to (evidence.py). Unverifiable claims are downgraded: a comparison cell becomes "not
reported", an "evidence-backed" gap becomes an "AI hypothesis". Nothing is ever called novel.
"""
from __future__ import annotations

import hashlib
import json
import logging

from .. import llm
from .evidence import evidence_text, valid_quote

log = logging.getLogger("lab.explorer.synth")

STATUSES = ("implemented_verified", "explicitly_not_implemented", "not_reported", "proposed_not_validated")
DESCRIPTIVE = ("models", "datasets", "metrics", "strengths", "limitations")
NOVELTY = "Not verified as novel. This is based only on the papers found here; a wider literature check is still needed."


def _sid(prefix: str, text: str) -> str:
    return prefix + hashlib.sha1((text or "").strip().lower().encode()).hexdigest()[:10]


def _short(p: dict) -> dict:
    f = p.get("facts") or {}
    return {
        "id": p["id"], "title": p["title"], "year": p.get("year"), "contribution": f.get("contribution"), "methodology": f.get("methodology"),
        "datasets": [{"name": d.get("name"), "quote": d.get("quote")} for d in f.get("datasets", [])],
        "metrics": [{"name": m.get("name"), "value": m.get("value"), "quote": m.get("quote")} for m in f.get("metrics", [])],
        "limitations": [{"text": x.get("text"), "quote": x.get("quote")} for x in f.get("limitations", [])],
        "future_work": [{"text": x.get("text"), "quote": x.get("quote")} for x in f.get("future_work", [])],
    }


# ---------- comparison ----------

COMPARE_SYSTEM = (
    "You compare research systems for a literature review. You are given facts already extracted from paper abstracts, each with an "
    "exact quote. Build a comparison. RULES: (1) Only state what the quotes support; copy the supporting quote exactly into 'quote'. "
    "(2) Use status 'implemented_verified' only if a quote shows it was implemented AND evaluated/demonstrated; "
    "'explicitly_not_implemented' only if a quote explicitly says it is missing, unsupported or left out; "
    "'proposed_not_validated' if a quote says it is proposed/planned/future work; otherwise 'not_reported'. "
    "(3) NEVER assume something is absent because a paper does not mention it: that is 'not_reported'. "
    "Choose 3-6 'capabilities' that matter for this research area (short names). "
    'Return JSON: {"capabilities":[{"name":"","description":""}],'
    '"cells":[{"system":"id","column":"models|datasets|metrics|strengths|limitations","text":"","quote":""}],'
    '"capability_cells":[{"capability":"name","system":"id","status":"implemented_verified|explicitly_not_implemented|not_reported|proposed_not_validated","text":"","quote":""}]}'
)


def compare(systems: list[dict], by_id: dict[str, dict], warnings: list[str]) -> dict:
    out = {"systems": [{"id": s["id"], "name": s["title"], "year": s.get("year"), "url": s.get("url"), "is_uploaded": bool(s.get("is_seed"))} for s in systems],
           "descriptive": {c: {} for c in DESCRIPTIVE}, "capabilities": [], "underexplored": [], "ai": False}
    if not systems or not llm.available():
        return out
    data, _ = llm.chat_json("planner", COMPARE_SYSTEM, json.dumps([_short(s) for s in systems], ensure_ascii=False), max_tokens=5000, agent="research_b")
    if not isinstance(data, dict):
        warnings.append("The comparison could not be generated (the AI returned nothing usable); cells show 'not reported'.")
        return out
    out["ai"] = True
    ids = {s["id"] for s in systems}

    for c in data.get("cells") or []:
        if not isinstance(c, dict) or c.get("system") not in ids or c.get("column") not in DESCRIPTIVE:
            continue
        p = by_id[c["system"]]
        if c.get("text") and valid_quote(evidence_text(p), c.get("quote")):
            out["descriptive"][c["column"]][c["system"]] = {"status": "reported", "text": str(c["text"])[:400], "evidence": [{"paper_id": p["id"], "quote": c["quote"]}]}

    caps = []
    for cap in (data.get("capabilities") or [])[:6]:
        if isinstance(cap, dict) and isinstance(cap.get("name"), str) and cap["name"].strip():
            caps.append({"name": cap["name"].strip()[:70], "description": str(cap.get("description") or "")[:200], "cells": {}})
    names = {c["name"] for c in caps}
    for cell in data.get("capability_cells") or []:
        if not isinstance(cell, dict) or cell.get("system") not in ids or cell.get("capability") not in names:
            continue
        cap = next(c for c in caps if c["name"] == cell["capability"])
        p = by_id[cell["system"]]
        status = cell.get("status") if cell.get("status") in STATUSES else "not_reported"
        evidence = [{"paper_id": p["id"], "quote": cell["quote"]}] if valid_quote(evidence_text(p), cell.get("quote")) else []
        if status != "not_reported" and not evidence:
            status = "not_reported"  # a claim without a verifiable quote is not a claim
        cap["cells"][cell["system"]] = {"status": status, "text": str(cell.get("text") or "")[:300] if evidence else "", "evidence": evidence}
    for cap in caps:  # complete matrix: anything unanswered is explicitly "not reported", never assumed absent
        for s in systems:
            cap["cells"].setdefault(s["id"], {"status": "not_reported", "text": "", "evidence": []})
    out["capabilities"] = caps
    # Underexplored = at most one system has it verified AND at least one is not verified (computed, not asserted by the AI).
    for cap in caps:
        impl = [sid for sid, c in cap["cells"].items() if c["status"] == "implemented_verified"]
        explicit_no = [sid for sid, c in cap["cells"].items() if c["status"] == "explicitly_not_implemented"]
        if len(impl) <= 1 and len(systems) > 1:
            out["underexplored"].append({
                "capability": cap["name"], "implemented_in": impl, "explicitly_missing_in": explicit_no,
                "note": ("Explicitly reported as missing in at least one system." if explicit_no else "Verified in at most one system; the others do not report it, which does not prove it is absent."),
            })
    return out


# ---------- gaps ----------

GAP_SYSTEM = (
    "You identify possible RESEARCH GAPS from verified facts about related papers. RULES: (1) A gap is 'evidence_backed' ONLY if you can cite "
    "at least one exact quote (copied from the facts given) from a paper supporting it; otherwise mark it 'hypothesis'. (2) NEVER claim an idea is "
    "novel or unexplored in the literature; say what the papers show and what they do not report. (3) Prefer limitations shared by several papers, "
    "missing functionality, unresolved questions, inefficiency, weak evaluation, and chances to combine approaches. (4) At most 8 gaps. "
    'Return JSON: {"gaps":[{"title":"","category":"shared_limitation|missing_functionality|open_question|efficiency|evaluation|combination",'
    '"explanation":"","kind":"evidence_backed|hypothesis","evidence":[{"paper":"id","quote":""}],"impact":"low|medium|high","impact_reason":"","why_investigate":""}]}'
)
GAP_CATEGORIES = {"shared_limitation", "missing_functionality", "open_question", "efficiency", "evaluation", "combination"}


def find_gaps(papers: list[dict], comparison: dict, by_id: dict[str, dict], warnings: list[str]) -> list[dict]:
    if not llm.available():
        return []
    usable = [_short(p) for p in papers if (p.get("facts") or {}).get("limitations") or (p.get("facts") or {}).get("future_work") or (p.get("facts") or {}).get("contribution")]
    if not usable:
        warnings.append("No paper had enough extractable text to identify research gaps.")
        return []
    matrix = [{"capability": c["name"], "status_by_system": {sid: cell["status"] for sid, cell in c["cells"].items()}} for c in comparison.get("capabilities", [])]
    data, _ = llm.chat_json("planner", GAP_SYSTEM, json.dumps({"papers": usable[:14], "capability_matrix": matrix}, ensure_ascii=False), max_tokens=4500, agent="research_b")
    rows = data.get("gaps") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        warnings.append("Research gaps could not be generated (the AI returned nothing usable).")
        return []
    gaps = []
    for g in rows[:8]:
        if not isinstance(g, dict) or not isinstance(g.get("title"), str) or not g["title"].strip():
            continue
        evidence = []
        for e in g.get("evidence") or []:
            p = by_id.get(e.get("paper")) if isinstance(e, dict) else None
            if p and valid_quote(evidence_text(p), e.get("quote")):
                evidence.append({"paper_id": p["id"], "title": p["title"], "year": p.get("year"), "url": p.get("url"), "quote": e["quote"]})
        supporting = sorted({e["paper_id"] for e in evidence})
        kind = "evidence_backed" if evidence and g.get("kind") == "evidence_backed" else "hypothesis"
        confidence = "high" if kind == "evidence_backed" and len(supporting) >= 3 else "medium" if kind == "evidence_backed" and len(supporting) == 2 else "low"
        gaps.append({
            "id": _sid("gap-", g["title"]), "title": g["title"].strip()[:140],
            "category": g.get("category") if g.get("category") in GAP_CATEGORIES else "open_question",
            "explanation": str(g.get("explanation") or "")[:700], "kind": kind, "confidence": confidence,
            "confidence_basis": (f"{len(supporting)} paper{'s' if len(supporting) != 1 else ''} with verified quotes" if kind == "evidence_backed" else "no verified quote: an AI hypothesis, not a finding"),
            "evidence": evidence, "supporting_papers": supporting,
            "impact": g.get("impact") if g.get("impact") in ("low", "medium", "high") else "medium", "impact_reason": str(g.get("impact_reason") or "")[:300],
            "why_investigate": str(g.get("why_investigate") or "")[:400], "novelty": NOVELTY,
        })
    order = {"evidence_backed": 0, "hypothesis": 1}
    rank = {"high": 0, "medium": 1, "low": 2}
    gaps.sort(key=lambda x: (order[x["kind"]], rank[x["confidence"]], rank[x["impact"]]))
    return gaps


# ---------- recommendations ----------

REC_SYSTEM = (
    "You turn verified research gaps into prioritised improvement recommendations. Use ONLY the gaps given (reference them by id). "
    "Do not cite papers yourself: references are attached from the gaps. Be concrete and honest about effort. "
    'Return JSON: {"recommendations":[{"gap_ids":["gap id"],"title":"","limitation":"","improvement":"","benefit":"","complexity":"low|medium|high",'
    '"resources":"","dependencies":["..."],"evaluation":"","category":"essential|high_value|experimental"}]}'
)
REC_ORDER = {"essential": 0, "high_value": 1, "experimental": 2}


def recommend(gaps: list[dict], warnings: list[str]) -> list[dict]:
    if not gaps or not llm.available():
        return []
    slim = [{"id": g["id"], "title": g["title"], "explanation": g["explanation"], "kind": g["kind"], "confidence": g["confidence"], "impact": g["impact"]} for g in gaps]
    data, _ = llm.chat_json("planner", REC_SYSTEM, json.dumps(slim, ensure_ascii=False), max_tokens=4500, agent="research_b")
    rows = data.get("recommendations") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        warnings.append("Recommendations could not be generated (the AI returned nothing usable).")
        return []
    by_gap = {g["id"]: g for g in gaps}
    recs = []
    for r in rows[:12]:
        if not isinstance(r, dict) or not isinstance(r.get("improvement"), str) or not r["improvement"].strip():
            continue
        linked = [by_gap[i] for i in (r.get("gap_ids") or []) if i in by_gap]
        if not linked:
            continue  # a recommendation must come from a real gap
        cat = r.get("category") if r.get("category") in REC_ORDER else "experimental"
        strong = any(g["kind"] == "evidence_backed" and g["confidence"] in ("medium", "high") for g in linked)
        any_evidence = any(g["kind"] == "evidence_backed" for g in linked)
        if cat == "essential" and not strong:
            cat = "high_value" if any_evidence else "experimental"
        if cat == "high_value" and not any_evidence:
            cat = "experimental"
        refs = sorted({pid for g in linked for pid in g["supporting_papers"]})
        recs.append({
            "id": _sid("rec-", r.get("title") or r["improvement"]), "title": str(r.get("title") or r["improvement"])[:120],
            "gap_ids": [g["id"] for g in linked], "limitation": str(r.get("limitation") or linked[0]["title"])[:400],
            "improvement": r["improvement"].strip()[:600], "benefit": str(r.get("benefit") or "")[:400],
            "complexity": r.get("complexity") if r.get("complexity") in ("low", "medium", "high") else "medium",
            "resources": str(r.get("resources") or "")[:300],
            "dependencies": [str(d)[:100] for d in (r.get("dependencies") or []) if isinstance(d, str)][:6],
            "evaluation": str(r.get("evaluation") or "")[:400], "category": cat, "references": refs,
            "evidence_backed": any_evidence,
        })
    recs.sort(key=lambda x: (REC_ORDER[x["category"]], {"low": 0, "medium": 1, "high": 2}[x["complexity"]]))
    for i, r in enumerate(recs, 1):
        r["priority"] = i
    return recs
