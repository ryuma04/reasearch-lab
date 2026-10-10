"""Better-resource recommendations for datasets and repositories.

Runs inside the research stage (after sources are gathered, before the plan is approved). The researcher's own
resources are never replaced: they stay the reference, every candidate is judged by the same evidence-based
criteria, and a candidate is only called a better alternative when the evidence shows it. Discovery failures are
reported as failures, never as "no better resource". Decisions (accept / reject / keep / supplement) are stored by
the Go API and read back by the planner.
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
from collections import Counter
from datetime import datetime, timezone

from . import sources as code_sources

log = logging.getLogger("lab.resources")

BETTER, RELEVANT, POSSIBLE, NOT_BETTER, INSUFFICIENT, INACCESSIBLE = (
    "better_alternative", "relevant_alternative", "possible_needs_validation", "not_better", "insufficient_evidence", "inaccessible")
MARGIN = 12
STOP = set("this that with from have been were which their these those into using used based paper results study model models data dataset "
           "network neural learning deep method methods approach test errors small large trained training also more than most only such other "
           "between where when what show shows shown propose proposed present however while both each".split())
DS = {"relevance": 35, "documentation": 20, "access_licence": 15, "scale": 15, "freshness": 15}


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def rec_id(kind: str, url: str) -> str:
    return "rec-" + hashlib.sha1(f"{kind}:{url.lower().rstrip('/')}".encode()).hexdigest()[:10]


def objective_terms(text: str, n: int = 8) -> list[str]:
    words = [w for w in re.findall(r"[a-z][a-z0-9-]{3,}", text.lower()) if w not in STOP]
    return [w for w, _ in Counter(words).most_common(n)]


def objective_text(brief: dict, note: str = "") -> str:
    parts = [note]
    for p in brief.get("papers", []):
        parts += [p.get("title", ""), p.get("summary", "")[:600], p.get("field", "")]
        parts += [c.get("description", "") for c in p.get("claims", [])[:6]]
    return " ".join(x for x in parts if x)


# ---------- dataset discovery ----------

def _kaggle_auth() -> tuple[str, str] | None:
    u, k = os.environ.get("KAGGLE_USERNAME", ""), os.environ.get("KAGGLE_KEY", "")
    return (u, k) if u and k else None


def _hf_dataset(f: code_sources.Fetch, hid: str, user_provided: bool = False) -> dict:
    d = f.json(f"{code_sources.HF}/api/datasets/{hid}")
    c = {"host": "huggingface", "kind": "dataset", "id": hid, "name": hid, "url": f"{code_sources.HF}/datasets/{hid}", "user_provided": user_provided, "fetched": False}
    if not d:
        return c
    tags = [str(t) for t in d.get("tags") or []]
    card = d.get("cardData") or {}
    lic = next((t.split(":", 1)[1] for t in tags if t.startswith("license:")), "") or str(card.get("license") or "")
    size = next((t.split(":", 1)[1] for t in tags if t.startswith("size_categories:")), "")
    c.update(fetched=True, description=str(d.get("description") or card.get("pretty_name") or ""), tags=tags, licence=lic or "none", size_category=size,
             downloads=d.get("downloads"), likes=d.get("likes"), updated=d.get("lastModified"),
             files=[str(s.get("rfilename", "")) for s in d.get("siblings") or []][:100])
    return c


def _kaggle_candidates(f: code_sources.Fetch, query: str, auth: tuple[str, str]) -> list[dict]:
    try:
        r = code_sources.HTTP.get("https://www.kaggle.com/api/v1/datasets/list", params={"search": query, "sortBy": "relevance", "pageSize": 8}, auth=auth)
    except Exception as e:  # noqa: BLE001
        f.limits.append(f"Kaggle search failed: {type(e).__name__}")
        return []
    if r.status_code != 200:
        f.limits.append(f"Kaggle answered {r.status_code} (check KAGGLE_USERNAME / KAGGLE_KEY)")
        return []
    out = []
    for it in (r.json() or [])[:8]:
        ref = it.get("ref") or ""
        out.append({"host": "kaggle", "kind": "dataset", "id": ref, "name": it.get("title") or ref, "url": it.get("url") or f"https://www.kaggle.com/datasets/{ref}",
                    "user_provided": False, "fetched": True, "description": it.get("subtitle") or "", "tags": [t.get("name", "") for t in it.get("tags") or []],
                    "licence": it.get("licenseName") or "none", "downloads": it.get("downloadCount"), "likes": it.get("voteCount"), "updated": it.get("lastUpdated"),
                    "size_bytes": it.get("totalBytes"), "files": ["README"] if it.get("subtitle") else []})
    return out


def discover_datasets(f: code_sources.Fetch, terms: list[str], title: str) -> tuple[list[dict], list[dict]]:
    """(candidates, per-provider status). Provider status distinguishes ok / failed / not_configured."""
    providers: list[dict] = []
    seen: dict[str, dict] = {}
    queries = [q for q in (title[:80], " ".join(terms[:2])) if q.strip()]
    ok = fail = 0
    for q in queries:
        data = f.json(f"{code_sources.HF}/api/datasets", {"search": q, "limit": 5, "sort": "downloads", "direction": -1})
        if data is None:
            fail += 1
            continue
        ok += 1
        for it in data[:5]:
            if it.get("id"):
                seen.setdefault(f"huggingface:{it['id'].lower()}", it)
    cands = [_hf_dataset(f, it["id"]) for it in list(seen.values())[:6]]
    providers.append({"name": "huggingface", "status": "ok" if ok else "failed", "searches_ok": ok, "searches_failed": fail})
    auth = _kaggle_auth()
    if auth is None:
        providers.append({"name": "kaggle", "status": "not_configured", "note": "Set KAGGLE_USERNAME and KAGGLE_KEY to search Kaggle datasets"})
    else:
        before = len(f.limits)
        kc: list[dict] = []
        for q in queries:
            kc += _kaggle_candidates(f, q, auth)
        dedup = {c["id"].lower(): c for c in kc}
        cands += list(dedup.values())
        providers.append({"name": "kaggle", "status": "failed" if len(f.limits) > before and not dedup else "ok", "count": len(dedup)})
    return cands, providers


# ---------- dataset evaluation (same criteria for original and candidates) ----------

def _age(iso):
    return code_sources._age_years(iso)


def evaluate_dataset(c: dict, terms: list[str]) -> dict:
    crit: list[dict] = []

    def add(key: str, pts: int, notes: list[str]) -> None:
        crit.append({"key": key, "label": key.replace("_", " ").title(), "points": min(pts, DS[key]), "max": DS[key], "evidence": notes})

    if not c.get("fetched"):
        for k, mx in DS.items():
            crit.append({"key": k, "label": k.replace("_", " ").title(), "points": 0, "max": mx, "evidence": ["metadata could not be fetched; nothing is credited"]})
        c.update(score=0, criteria=crit, evidence_complete=False)
        return c
    blob = " ".join([c.get("name", ""), c.get("description", ""), " ".join(c.get("tags", []))]).lower()
    hit = [t for t in terms if t in blob]
    frac = len(hit) / max(1, len(terms))
    add("relevance", 35 if frac >= 0.5 else 25 if frac >= 0.3 else 15 if frac >= 0.15 else 0,
        [f"Matches {len(hit)} of {len(terms)} research terms" + (f" ({', '.join(hit[:5])})" if hit else "")])
    d, n = 0, []
    dl = len(c.get("description", ""))
    if dl >= 200: d += 12; n.append(f"Description of {dl} characters")
    elif dl >= 50: d += 6; n.append(f"Short description ({dl} characters)")
    else: n.append("No usable description")
    if any(x.lower().startswith("readme") for x in c.get("files", [])): d += 4; n.append("Has a README/dataset card")
    if any(t.startswith("task_categories:") for t in c.get("tags", [])): d += 4; n.append("Declares its task category")
    add("documentation", d, n)
    lic = c.get("licence", "none")
    add("access_licence", 5 + (10 if lic not in ("", "none") else 0), ["Metadata is publicly accessible", f"Licence: {lic}" if lic not in ("", "none") else "No licence stated"])
    sz = c.get("size_bytes")
    cat = c.get("size_category")
    add("scale", 8 if (sz or cat) else 0, [f"Size {sz / 1e6:.1f} MB" if sz else f"Size category {cat}" if cat else "No size information"])
    age = _age(c.get("updated"))
    add("freshness", 0 if age is None else 15 if age <= 1 else 8 if age <= 2 else 4 if age <= 4 else 0, ["Last update unknown" if age is None else f"Updated {age:.1f} years ago"])
    c.update(score=sum(x["points"] for x in crit), criteria=crit, relevance_terms=hit, evidence_complete=dl >= 50 or bool(sz or cat))
    return c


def _by_key(c: dict) -> dict:
    return {x["key"]: x for x in c.get("criteria", [])}


def _public(c: dict) -> dict:
    keys = ("host", "kind", "id", "name", "url", "user_provided", "fetched", "description", "licence", "updated", "downloads", "likes", "score", "criteria",
            "evidence_complete", "language", "stars", "size_bytes", "size_category")
    out = {k: c[k] for k in keys if k in c}
    out["description"] = (out.get("description") or "")[:400]
    return out


def classify(original: dict | None, cand: dict) -> tuple[str, str, list[str], list[str]]:
    """(category, action, advantages, limitations) from evidence only."""
    if not cand.get("fetched"):
        return INACCESSIBLE, "keep_original", [], ["The resource's metadata could not be fetched"]
    rel = _by_key(cand).get("relevance", {}).get("points", 0)
    if rel == 0:
        return NOT_BETTER, "keep_original", [], ["Does not match the research objective"]
    if original is None or not original.get("fetched"):
        why = "No original resource was supplied" if original is None else "The original resource's metadata was unavailable, so a fair comparison is not possible"
        cat = POSSIBLE if cand["score"] >= 50 and rel >= 25 else RELEVANT
        return cat, "supplement", [f"Relevant to the objective ({rel}/35 relevance)"], [why]
    ok = _by_key(original)
    adv = [f"{x['label']}: {'; '.join(x['evidence'])}" for x in cand["criteria"] if x["points"] > ok[x["key"]]["points"]]
    lim = [f"{x['label']}: {'; '.join(x['evidence'])}" for x in cand["criteria"] if x["points"] < ok[x["key"]]["points"]]
    wins = len(adv)
    if cand["score"] >= original["score"] + MARGIN and wins >= 2 and rel >= 15 and cand.get("evidence_complete"):
        return BETTER, "replace" if cand["score"] >= original["score"] + 2 * MARGIN else "supplement", adv, lim
    if cand["score"] <= original["score"]:
        return NOT_BETTER, "keep_original", adv, lim
    if not cand.get("evidence_complete"):
        return INSUFFICIENT, "keep_original", adv, lim + ["Not enough metadata on one side to show it is better"]
    return POSSIBLE, "supplement", adv, lim + ["Ahead on score but not by a clear margin; validate before using"]


def record(kind: str, original: dict | None, cand: dict, source: str) -> dict:
    cat, action, adv, lim = classify(original, cand)
    conf = "high" if cat == BETTER and cand["score"] >= (original or {}).get("score", 0) + 2 * MARGIN else "medium" if cat in (BETTER, POSSIBLE) else "low"
    ev = [x for c in cand.get("criteria", []) for x in c["evidence"]][:8]
    summary = (f"{cand['name']} scores {cand['score']}/100 against {original['score']}/100 for your {kind}." if original and original.get("fetched")
               else f"{cand['name']} is a candidate {kind}; the original could not be scored.")
    return {"id": rec_id(kind, cand["url"]), "kind": kind, "source": source, "url": cand["url"], "name": cand["name"],
            "original": {"name": original.get("name"), "url": original.get("url")} if original else None,
            "category": cat, "action": action, "score": cand.get("score") if cand.get("fetched") else None, "confidence": conf,
            "summary": summary, "advantages": adv, "limitations": lim, "evidence": ev, "criteria": cand.get("criteria", []),
            "evaluated_at": now(), "candidate": _public(cand)}


# ---------- orchestration ----------

def from_code_assessment(code: dict) -> list[dict]:
    """Repository recommendations come from the existing like-for-like repository assessment."""
    out = []
    orig = (code.get("original") or [None])[0]
    rec_url = (code.get("recommended") or {}).get("url")
    for a in code.get("alternatives", []):
        if not a.get("mentions_paper") and a.get("url") != rec_url:
            continue
        if not a.get("fetched"):
            cat, action = INACCESSIBLE, "keep_original"
        elif code["verdict"] == "better_alternative" and a["url"] == rec_url:
            cat, action = BETTER, "supplement"
        elif code["verdict"] == "interesting_alternative" and a["url"] == rec_url:
            cat, action = POSSIBLE, "supplement"
        elif code["verdict"] == "suggested_source" and a["url"] == rec_url:
            cat, action = RELEVANT, "supplement"
        elif orig and orig.get("fetched") and a.get("score", 0) <= orig.get("score", 0):
            cat, action = NOT_BETTER, "keep_original"
        else:
            cat, action = RELEVANT, "supplement"
        adv = code.get("advantages", []) if a["url"] == rec_url else []
        lim = code.get("tradeoffs", []) if a["url"] == rec_url else []
        out.append({"id": rec_id("repository", a["url"]), "kind": "repository", "source": a.get("host", "github"), "url": a["url"], "name": a.get("name") or a["url"],
                    "original": {"name": orig.get("name"), "url": orig.get("url")} if orig else None, "category": cat, "action": action,
                    "score": a.get("score") if a.get("fetched") else None,
                    "confidence": code.get("confidence", "low") if a["url"] == rec_url else "low",
                    "summary": code.get("summary", "") if a["url"] == rec_url else f"{a.get('name')} scored {a.get('score')}/100.",
                    "advantages": adv, "limitations": lim or ["Fetched evidence only; review the code before relying on it"],
                    "evidence": [x for c in a.get("criteria", []) for x in c["evidence"]][:8], "criteria": a.get("criteria", []),
                    "evaluated_at": now(), "candidate": a})
    return out


def decisions_for(run_id: int, brief: dict) -> list[dict]:
    """The researcher's decisions joined with the recommendation they refer to (sorted, so it can be compared)."""
    from . import db
    recs = {r["id"]: r for r in (brief.get("sources", {}).get("resources") or {}).get("recommendations", [])}
    out = []
    for d in db.q("SELECT rec_id, decision, note FROM resource_decisions WHERE run_id=%s ORDER BY rec_id", (run_id,)):
        r = recs.get(d["rec_id"])
        if r:
            out.append({"rec_id": d["rec_id"], "decision": d["decision"], "note": d["note"], "name": r["name"], "url": r["url"], "kind": r["kind"],
                        "category": r["category"], "original": (r.get("original") or {}).get("name")})
    return out


def status_of(providers: list[dict]) -> str:
    live = [p for p in providers if p["status"] != "not_configured"]
    if not live or all(p["status"] == "failed" for p in live):
        return "failed"
    return "partial" if any(p["status"] == "failed" for p in live) else "completed"


def build(brief: dict, sources: dict, code: dict | None, note: str = "") -> dict:
    """The `resources` block stored in the brief: discovery status, providers and the recommendation records."""
    text = objective_text(brief, note)
    terms = objective_terms(text)
    title = (brief.get("papers") or [{}])[0].get("title", "")
    f = code_sources.Fetch()
    providers: list[dict] = []
    recs: list[dict] = []
    # repositories (existing assessment) and its provider health
    if code is not None:
        recs += from_code_assessment(code)
        providers += code.get("providers", [])
    # datasets
    try:
        originals = [d for d in sources.get("datasets", []) if d.get("user_provided")]
        orig = None
        if originals:
            o = originals[0]
            m = re.search(r"huggingface\.co/datasets/([^/\s]+/[^/\s?#]+)", o.get("url") or "")
            orig = evaluate_dataset(_hf_dataset(f, m.group(1), True) if m else
                                    {"host": "other", "kind": "dataset", "id": o.get("name", ""), "name": o.get("name", "your dataset"), "url": o.get("url") or o.get("name", ""),
                                     "user_provided": True, "fetched": False}, terms)
            orig["name"] = o.get("name") or orig["name"]
            orig["url"] = o.get("url") or orig["url"]
        cands, dprov = discover_datasets(f, terms, title)
        providers += dprov
        original_urls = {(orig or {}).get("url", "").lower()}
        for c in cands:
            if c["url"].lower() in original_urls:
                continue
            evaluate_dataset(c, terms)
            r = record("dataset", orig, c, c["host"])
            if not c.get("fetched") or _by_key(c).get("relevance", {}).get("points", 0) > 0:  # irrelevant candidates are dropped, not listed
                recs.append(r)
    except Exception:  # noqa: BLE001 - dataset discovery must never discard the research results
        log.exception("dataset discovery failed")
        providers.append({"name": "datasets", "status": "failed", "note": "Dataset discovery raised an error"})
    uniq: dict[str, dict] = {}
    for r in recs:
        uniq.setdefault(r["id"], r)
    recs = sorted(uniq.values(), key=lambda r: ({BETTER: 0, POSSIBLE: 1, RELEVANT: 2, INSUFFICIENT: 3, NOT_BETTER: 4, INACCESSIBLE: 5}[r["category"]], -(r["score"] or 0)))
    status = status_of(providers)
    better = sum(r["category"] == BETTER for r in recs)
    if status == "failed":
        note = "Discovery could not be completed (no provider answered). No conclusion about better resources can be drawn; continue with your original resources or retry."
    elif better:
        note = f"{better} better alternative(s) found. Your original resources are kept unless you accept a recommendation."
    elif recs:
        note = "Relevant resources were found, but none is demonstrably better than yours. Your original resources are kept."
    else:
        note = "No alternative was found" + (" (some providers failed, so this is not conclusive)." if status == "partial" else ".")
    return {"status": status, "providers": providers, "terms": terms, "recommendations": recs, "note": note, "evaluated_at": now(),
            "limitations": sorted(set(f.limits))}
