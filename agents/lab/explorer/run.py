"""Research Gap Explorer: orchestration. Runs as a background job (type "explorer") and stores its result in
explorer_analyses. It only READS the Research Agent's output (research/brief.json); it never changes the research workflow.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone

import httpx

from .. import db
from ..project import pdir
from . import scholar
from .evidence import evidence_text
from .extract import extract_all
from .synth import compare, find_gaps, recommend

log = logging.getLogger("lab.explorer")

MAX_REFS, MAX_CITS, MAX_RELATED, MAX_COMPARED = 12, 12, 8, 7
REL_RANK = {"seed": 0, "builds_on": 1, "cited_by": 2, "related": 3}


def _progress(analysis_id: int):
    def set_stage(stage: str) -> None:
        db.ex("UPDATE explorer_analyses SET stage=%s, updated_at=now() WHERE id=%s", (stage[:200], analysis_id))
    return set_stage


def load_seed(run_id: int) -> tuple[dict, dict]:
    """The uploaded paper, as the Research Agent analysed it. Raises LookupError if the analysis is not finished."""
    path = pdir(run_id) / "research" / "brief.json"
    if not path.exists():
        raise LookupError("This paper has not been analysed yet. Wait for the research stage to finish, then open the Gap Explorer.")
    brief = json.loads(path.read_text(encoding="utf-8"))
    papers = brief.get("papers") or []
    if not papers:
        raise LookupError("The research analysis contains no paper.")
    return papers[0], brief


def seed_record(client: httpx.Client, info: dict, warn: scholar.Warnings) -> dict:
    arxiv = scholar.clean_arxiv(info.get("arxiv_id"))
    found = scholar.s2_paper(client, warn, arxiv_id=arxiv, title=info.get("title"))
    if not found and info.get("title"):
        for p in scholar.arxiv_search(client, warn, info["title"], 3):
            if scholar.norm_title(p["title"]) == scholar.norm_title(info["title"]):
                found = p
                break
    seed = found or scholar.blank(title=info.get("title") or "Uploaded paper", arxiv_id=arxiv, sources=["research-agent"])
    if arxiv and not seed.get("arxiv_id"):
        seed["arxiv_id"] = arxiv
    seed["title"] = seed.get("title") or info.get("title") or "Uploaded paper"
    # Text the Research Agent already extracted from the uploaded paper: quotes about it are checked against this too.
    claims = info.get("claims") or []
    seed["analysis_text"] = "\n".join(
        [info.get("summary") or ""] + [str(m) for m in info.get("method") or []] +
        [f"{c.get('description', '')}: {c.get('value')} {c.get('unit') or ''}. {c.get('quote') or ''}" for c in claims] +
        ["Details the paper does not state: " + "; ".join(str(m) for m in info.get("missing_details") or [])] * bool(info.get("missing_details")))
    seed["is_seed"] = True
    seed["relation"] = "seed"
    return seed


def _query_for(info: dict) -> str:
    return (info.get("title") or "")[:200]


def discover(client: httpx.Client, seed: dict, info: dict, warn: scholar.Warnings, progress) -> list[dict]:
    progress("Finding related research")
    mailto = os.environ.get("OPENALEX_MAILTO") or None
    found: list[dict] = []
    refs: list[dict] = []
    cits: list[dict] = []
    if seed.get("s2_id"):
        refs = scholar.s2_edges(client, warn, seed["s2_id"], "references", 50)
        cits = scholar.s2_edges(client, warn, seed["s2_id"], "citations", 50)
    q = _query_for(info)
    others = []
    if q:
        others += scholar.oa_search(client, warn, q, 15, mailto)
        others += scholar.s2_search(client, warn, q, 10)
        others += scholar.arxiv_search(client, warn, q, 10)
    byc = lambda p: p.get("citations") or 0  # noqa: E731
    for p in sorted(refs, key=byc, reverse=True)[:MAX_REFS]:
        p["relation"] = "builds_on"
        found.append(p)
    for p in sorted(cits, key=byc, reverse=True)[:MAX_CITS]:
        p["relation"] = "cited_by"
        found.append(p)
    for p in sorted(others, key=byc, reverse=True):
        p["relation"] = "related"
        found.append(p)
    papers = scholar.dedupe([seed] + found)
    seed = papers[0]
    # Drop the seed's own duplicates and anything without a title.
    keep: list[dict] = [seed]
    counts = {"builds_on": 0, "cited_by": 0, "related": 0}
    caps = {"builds_on": MAX_REFS, "cited_by": MAX_CITS, "related": MAX_RELATED}
    rest = sorted(papers[1:], key=lambda p: (REL_RANK.get(p.get("relation", "related"), 3), -(len(p.get("sources", [])) * 1000 + (p.get("citations") or 0))))
    for p in rest:
        rel = p.get("relation") or "related"
        if scholar.norm_title(p["title"]) == scholar.norm_title(seed["title"]) or counts[rel] >= caps[rel]:
            continue
        counts[rel] += 1
        keep.append(p)
    return keep


def enrich(client: httpx.Client, papers: list[dict], warn: scholar.Warnings, progress) -> None:
    """Fill missing DOIs from Crossref (exact title match only) so more papers get a real link."""
    progress("Completing publication details")
    todo = [p for p in papers if not p.get("doi") and not p.get("arxiv_id") and p.get("title")][:8]
    for p in todo:
        hit = scholar.crossref_lookup(client, warn, p["title"], p.get("year"))
        if hit:
            scholar.merge(p, hit)
            p["id"] = scholar.paper_id(p)
            p["url"] = scholar.best_url(p)


def citation_edges(client: httpx.Client, papers: list[dict], warn: scholar.Warnings) -> list[dict]:
    """Edges A -> B ("A cites B") only where a reference list says so."""
    by_s2 = {p["s2_id"]: p for p in papers if p.get("s2_id")}
    edges: dict[tuple[str, str], dict] = {}
    refs = scholar.s2_reference_ids(client, warn, list(by_s2)) if by_s2 else {}
    for sid, cited in refs.items():
        for c in cited:
            if c in by_s2 and c != sid:
                edges[(by_s2[sid]["id"], by_s2[c]["id"])] = {"from": by_s2[sid]["id"], "to": by_s2[c]["id"], "kind": "cites", "evidence": "reference list (Semantic Scholar)"}
    seed = papers[0]
    for p in papers[1:]:  # relationships learned when the papers were found, in case the batch lookup failed
        if p.get("relation") == "builds_on":
            edges.setdefault((seed["id"], p["id"]), {"from": seed["id"], "to": p["id"], "kind": "cites", "evidence": "reference list (Semantic Scholar)"})
        elif p.get("relation") == "cited_by":
            edges.setdefault((p["id"], seed["id"]), {"from": p["id"], "to": seed["id"], "kind": "cites", "evidence": "citation list (Semantic Scholar)"})
    return list(edges.values())


def public(p: dict) -> dict:
    f = p.get("facts") or {}
    return {
        "id": p["id"], "title": p["title"], "authors": p.get("authors") or [], "year": p.get("year"), "venue": p.get("venue"),
        "url": p.get("url"), "doi": p.get("doi"), "arxiv_id": p.get("arxiv_id"), "citations": p.get("citations"), "relation": p.get("relation") or "related",
        "sources": p.get("sources") or [], "is_seed": bool(p.get("is_seed")), "has_abstract": bool(p.get("abstract")),
        "abstract": (p.get("abstract") or "")[:1500] or None,
        "category": f.get("category"), "category_source": f.get("category_source"), "methodology": f.get("methodology") or [],
        "contribution": f.get("contribution"), "limitations": f.get("limitations") or [], "future_work": f.get("future_work") or [],
        "datasets": f.get("datasets") or [], "metrics": f.get("metrics") or [], "facts_by": f.get("extracted_by"),
    }


def analyse(run_id: int, progress) -> dict:
    info, _brief = load_seed(run_id)
    warn = scholar.Warnings()
    with httpx.Client(headers=scholar.HEADERS, follow_redirects=True) as client:
        progress("Looking up the uploaded paper")
        seed = seed_record(client, info, warn)
        papers = discover(client, seed, info, warn, progress)
        if len(papers) < 2:
            raise LookupError("No related research could be found from Semantic Scholar, OpenAlex, Crossref or arXiv. "
                              + (" ".join(warn) if warn else "Try again in a few minutes."))
        enrich(client, papers, warn, progress)
        progress("Linking papers by their citations")
        edges = citation_edges(client, papers, warn)
    seed = papers[0]
    by_id = {p["id"]: p for p in papers}

    progress("Reading abstracts")
    extract_all(papers, warn, progress)
    ranked = sorted(papers[1:], key=lambda p: (not (p.get("abstract")), REL_RANK.get(p.get("relation", "related"), 3), -(p.get("citations") or 0)))
    systems = [seed] + [p for p in ranked if evidence_text(p)][:MAX_COMPARED]
    progress("Comparing systems")
    comparison = compare(systems, by_id, warn)
    progress("Identifying research gaps")
    gaps = find_gaps(papers, comparison, by_id, warn)
    progress("Prioritising improvements")
    recs = recommend(gaps, warn)

    return {
        "seed_id": seed["id"], "papers": [public(p) for p in papers], "edges": edges, "comparison": comparison, "gaps": gaps, "recommendations": recs,
        "warnings": list(warn), "generated_at": datetime.now(timezone.utc).isoformat(),
        "limits": {
            "papers_found": len(papers), "with_abstract": sum(1 for p in papers if p.get("abstract")),
            "basis": "Facts come from abstracts and metadata only; full texts were not read.",
            "sources": sorted({s for p in papers for s in p.get("sources", [])}),
        },
    }


def run(analysis_id: int) -> None:
    """Background job. Never raises: failures are stored for the researcher to see."""
    row = db.q1("SELECT id, run_id FROM explorer_analyses WHERE id=%s", (analysis_id,))
    if not row:
        return
    db.ex("UPDATE explorer_analyses SET status='running', stage='Starting', error='', updated_at=now() WHERE id=%s", (analysis_id,))
    try:
        data = analyse(row["run_id"], _progress(analysis_id))
        db.ex("UPDATE explorer_analyses SET status='done', stage='', data=%s, error='', updated_at=now(), finished_at=now() WHERE id=%s", (db.J(data), analysis_id))
    except LookupError as e:
        db.ex("UPDATE explorer_analyses SET status='failed', stage='', error=%s, updated_at=now(), finished_at=now() WHERE id=%s", (str(e)[:1500], analysis_id))
    except Exception as e:  # noqa: BLE001
        log.exception("explorer %s failed", analysis_id)
        db.ex("UPDATE explorer_analyses SET status='failed', stage='', error=%s, updated_at=now(), finished_at=now() WHERE id=%s",
              (f"The analysis stopped unexpectedly: {type(e).__name__}. Try again.", analysis_id))
