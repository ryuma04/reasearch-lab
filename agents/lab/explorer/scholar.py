"""Scholarly source clients for the Research Gap Explorer: Semantic Scholar, OpenAlex, Crossref and arXiv.

Every client returns plain paper dicts in one normalised shape, tolerates failures (a source that is down, rate
limited or returns junk contributes nothing and a warning is recorded) and never invents a field: anything a source
did not provide stays None / empty.

Paper dict:
  id          stable id used by the Explorer ("doi:...", "arxiv:...", "s2:...", "oa:...", or "t:<title hash>")
  title, authors[str], year, venue, abstract, url (a real landing page), doi, arxiv_id, citations, fields[str]
  s2_id, oa_id    ids on the sources that knew the paper; sources[str] = which sources reported it
"""
from __future__ import annotations

import hashlib
import html
import logging
import re
import time
import xml.etree.ElementTree as ET
from typing import Any

import httpx

log = logging.getLogger("lab.explorer.scholar")

HEADERS = {"User-Agent": "ResearchLab-GapExplorer/1.0 (+https://github.com/ryuma04/tapu-sena)"}
S2 = "https://api.semanticscholar.org/graph/v1"
OA = "https://api.openalex.org"
CROSSREF = "https://api.crossref.org"
ARXIV = "http://export.arxiv.org/api/query"
S2_FIELDS = "title,abstract,year,venue,citationCount,externalIds,url,fieldsOfStudy,authors.name"


class Warnings(list):
    """Collects human-readable problems (rate limits, unreachable sources) shown to the researcher."""

    def add(self, msg: str) -> None:
        if msg not in self:
            self.append(msg)


def _get(client: httpx.Client, url: str, warn: Warnings, name: str, *, params: dict | None = None, retries: int = 3,
         method: str = "GET", json_body: Any = None) -> Any | None:
    """GET/POST with bounded retries and backoff on 429 / 5xx. Returns parsed JSON (or text for non-JSON), else None."""
    delay = 1.5
    for attempt in range(retries + 1):
        try:
            r = client.request(method, url, params=params, json=json_body, timeout=25)
        except httpx.HTTPError as e:
            if attempt == retries:
                warn.add(f"{name} could not be reached ({type(e).__name__}); its results are missing.")
                return None
            time.sleep(delay)
            delay *= 2
            continue
        if r.status_code == 429 or r.status_code >= 500:
            if attempt == retries:
                warn.add(f"{name} is rate limiting or unavailable right now (HTTP {r.status_code}); its results may be incomplete.")
                return None
            wait = float(r.headers.get("Retry-After", delay)) if str(r.headers.get("Retry-After", "")).replace(".", "").isdigit() else delay
            time.sleep(min(wait, 12))
            delay *= 2
            continue
        if r.status_code == 404:
            return None
        if r.status_code >= 400:
            warn.add(f"{name} returned HTTP {r.status_code}.")
            return None
        try:
            return r.json()
        except ValueError:
            return r.text
    return None


def norm_title(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (t or "").lower()).strip()


def clean_doi(d: str | None) -> str | None:
    if not d:
        return None
    d = re.sub(r"^https?://(dx\.)?doi\.org/", "", d.strip(), flags=re.I).lower()
    return d if re.match(r"^10\.\d{4,9}/\S+$", d) else None


def clean_arxiv(a: str | None) -> str | None:
    if not a:
        return None
    a = re.sub(r"^(https?://arxiv\.org/(abs|pdf)/|arxiv:)", "", a.strip(), flags=re.I)
    a = re.sub(r"(\.pdf)?$", "", a)
    a = re.sub(r"v\d+$", "", a)
    return a if re.match(r"^(\d{4}\.\d{4,5}|[a-z\-]+(\.[A-Z]{2})?/\d{7})$", a) else None


def web_url(u: Any) -> str | None:
    return u if isinstance(u, str) and re.match(r"^https?://[^\s]+$", u) else None


def paper_id(p: dict) -> str:
    if p.get("doi"):
        return f"doi:{p['doi']}"
    if p.get("arxiv_id"):
        return f"arxiv:{p['arxiv_id']}"
    if p.get("s2_id"):
        return f"s2:{p['s2_id']}"
    if p.get("oa_id"):
        return f"oa:{p['oa_id']}"
    return "t:" + hashlib.sha1(norm_title(p.get("title", "")).encode()).hexdigest()[:12]


def best_url(p: dict) -> str | None:
    """A real landing page, in order of how canonical it is. Never built from a title."""
    if p.get("doi"):
        return f"https://doi.org/{p['doi']}"
    if p.get("arxiv_id"):
        return f"https://arxiv.org/abs/{p['arxiv_id']}"
    return web_url(p.get("url"))


def blank(**kw: Any) -> dict:
    p = {"title": "", "authors": [], "year": None, "venue": None, "abstract": None, "url": None, "doi": None, "arxiv_id": None,
         "citations": None, "fields": [], "s2_id": None, "oa_id": None, "sources": []}
    p.update(kw)
    return p


# ---------- Semantic Scholar ----------

def _s2(d: dict, source: str = "semanticscholar") -> dict | None:
    if not isinstance(d, dict) or not d.get("title"):
        return None
    ext = d.get("externalIds") or {}
    return blank(
        title=d["title"].strip(), authors=[a.get("name") for a in d.get("authors") or [] if a.get("name")], year=d.get("year"),
        venue=(d.get("venue") or None), abstract=(d.get("abstract") or None), url=web_url(d.get("url")), doi=clean_doi(ext.get("DOI")),
        arxiv_id=clean_arxiv(ext.get("ArXiv")), citations=d.get("citationCount"), fields=list(d.get("fieldsOfStudy") or []),
        s2_id=d.get("paperId"), sources=[source])


def s2_paper(client: httpx.Client, warn: Warnings, *, arxiv_id: str | None = None, doi: str | None = None, title: str | None = None) -> dict | None:
    ref = f"ARXIV:{arxiv_id}" if arxiv_id else f"DOI:{doi}" if doi else None
    if ref:
        d = _get(client, f"{S2}/paper/{ref}", warn, "Semantic Scholar", params={"fields": S2_FIELDS})
        if isinstance(d, dict) and d.get("paperId"):
            return _s2(d)
    if title:
        res = s2_search(client, warn, title, 3)
        for p in res:
            if norm_title(p["title"]) == norm_title(title):
                return p
    return None


def s2_edges(client: httpx.Client, warn: Warnings, s2_id: str, kind: str, limit: int = 40) -> list[dict]:
    """kind = 'references' (papers it cites) or 'citations' (papers citing it)."""
    d = _get(client, f"{S2}/paper/{s2_id}/{kind}", warn, "Semantic Scholar", params={"fields": S2_FIELDS, "limit": limit})
    out = []
    key = "citedPaper" if kind == "references" else "citingPaper"
    for row in (d or {}).get("data", []) if isinstance(d, dict) else []:
        p = _s2(row.get(key) or {})
        if p:
            out.append(p)
    return out


def s2_search(client: httpx.Client, warn: Warnings, query: str, limit: int = 15) -> list[dict]:
    d = _get(client, f"{S2}/paper/search", warn, "Semantic Scholar", params={"query": query[:200], "fields": S2_FIELDS, "limit": limit})
    return [p for p in (_s2(x) for x in (d or {}).get("data", [])) if p] if isinstance(d, dict) else []


def s2_reference_ids(client: httpx.Client, warn: Warnings, ids: list[str]) -> dict[str, set[str]]:
    """For each paper id, the set of Semantic Scholar ids it cites (one batch request): real citation edges between papers."""
    if not ids:
        return {}
    d = _get(client, f"{S2}/paper/batch", warn, "Semantic Scholar", method="POST", params={"fields": "references.paperId"}, json_body={"ids": ids[:500]})
    out: dict[str, set[str]] = {}
    if isinstance(d, list):
        for pid, row in zip(ids, d):
            if isinstance(row, dict):
                out[pid] = {r.get("paperId") for r in row.get("references") or [] if r and r.get("paperId")}
    return out


# ---------- OpenAlex ----------

def _inverted(idx: dict | None) -> str | None:
    if not isinstance(idx, dict) or not idx:
        return None
    words: list[tuple[int, str]] = []
    for w, pos in idx.items():
        words += [(p, w) for p in pos]
    return " ".join(w for _, w in sorted(words)) or None


def _oa(d: dict) -> dict | None:
    if not isinstance(d, dict) or not d.get("title"):
        return None
    loc = d.get("primary_location") or {}
    ids = d.get("ids") or {}
    arxiv = None
    for l in d.get("locations") or []:
        a = clean_arxiv(l.get("landing_page_url") or "")
        if a:
            arxiv = a
            break
    topics = [t.get("display_name") for t in (d.get("topics") or [])[:3] if t.get("display_name")]
    return blank(
        title=d["title"].strip(), authors=[(a.get("author") or {}).get("display_name") for a in d.get("authorships") or [] if (a.get("author") or {}).get("display_name")],
        year=d.get("publication_year"), venue=((loc.get("source") or {}).get("display_name")), abstract=_inverted(d.get("abstract_inverted_index")),
        url=web_url(loc.get("landing_page_url")) or web_url(ids.get("openalex")), doi=clean_doi(d.get("doi") or ids.get("doi")), arxiv_id=arxiv,
        citations=d.get("cited_by_count"), fields=topics, oa_id=(d.get("id") or "").rsplit("/", 1)[-1] or None, sources=["openalex"])


def oa_search(client: httpx.Client, warn: Warnings, query: str, limit: int = 15, mailto: str | None = None) -> list[dict]:
    params = {"search": query[:250], "per-page": limit, "sort": "relevance_score:desc"}
    if mailto:
        params["mailto"] = mailto
    d = _get(client, f"{OA}/works", warn, "OpenAlex", params=params)
    return [p for p in (_oa(x) for x in (d or {}).get("results", [])) if p] if isinstance(d, dict) else []


def oa_by_doi(client: httpx.Client, warn: Warnings, doi: str) -> dict | None:
    d = _get(client, f"{OA}/works/doi:{doi}", warn, "OpenAlex")
    return _oa(d) if isinstance(d, dict) else None


# ---------- Crossref (metadata and DOIs only) ----------

def crossref_lookup(client: httpx.Client, warn: Warnings, title: str, year: int | None) -> dict | None:
    d = _get(client, f"{CROSSREF}/works", warn, "Crossref", params={"query.title": title[:250], "rows": 3, "select": "DOI,title,author,issued,container-title,URL"}, retries=1)
    for it in ((d or {}).get("message", {}) or {}).get("items", []) if isinstance(d, dict) else []:
        t = (it.get("title") or [""])[0]
        if norm_title(t) != norm_title(title):
            continue  # only an exact title match counts: never attach a DOI to a different paper
        y = ((it.get("issued") or {}).get("date-parts") or [[None]])[0][0]
        if year and y and abs(int(y) - int(year)) > 1:
            continue
        return blank(title=t, doi=clean_doi(it.get("DOI")), year=y, venue=(it.get("container-title") or [None])[0], url=web_url(it.get("URL")),
                     authors=[" ".join(x for x in [a.get("given"), a.get("family")] if x) for a in it.get("author") or []], sources=["crossref"])
    return None


# ---------- arXiv ----------

_NS = {"a": "http://www.w3.org/2005/Atom"}


def arxiv_search(client: httpx.Client, warn: Warnings, query: str, limit: int = 10) -> list[dict]:
    q = " AND ".join(f"all:{w}" for w in re.findall(r"[A-Za-z0-9\-]{3,}", query)[:8])
    if not q:
        return []
    txt = _get(client, ARXIV, warn, "arXiv", params={"search_query": q, "max_results": limit, "sortBy": "relevance"})
    if not isinstance(txt, str):
        return []
    try:
        root = ET.fromstring(txt)
    except ET.ParseError:
        warn.add("arXiv returned a response that could not be read.")
        return []
    out = []
    for e in root.findall("a:entry", _NS):
        title = html.unescape(re.sub(r"\s+", " ", (e.findtext("a:title", "", _NS) or "").strip()))
        aid = clean_arxiv(e.findtext("a:id", "", _NS))
        if not title or not aid:
            continue
        pub = e.findtext("a:published", "", _NS) or ""
        out.append(blank(title=title, authors=[x.findtext("a:name", "", _NS) for x in e.findall("a:author", _NS)], year=int(pub[:4]) if pub[:4].isdigit() else None,
                         abstract=re.sub(r"\s+", " ", (e.findtext("a:summary", "", _NS) or "").strip()) or None, arxiv_id=aid, venue="arXiv",
                         url=f"https://arxiv.org/abs/{aid}", sources=["arxiv"]))
    return out


# ---------- merge ----------

def merge(into: dict, other: dict) -> dict:
    """Fill gaps in `into` from `other` (never overwrite a value a source already gave)."""
    for k, v in other.items():
        if k == "sources":
            into["sources"] = sorted(set(into["sources"]) | set(v))
        elif k == "authors":
            into["authors"] = into["authors"] or v
        elif k == "fields":
            into["fields"] = into["fields"] or v
        elif k == "citations":
            nums = [x for x in (into.get("citations"), v) if isinstance(x, int)]
            into["citations"] = max(nums) if nums else None
        elif into.get(k) in (None, "", []) and v not in (None, "", []):
            into[k] = v
    return into


def dedupe(papers: list[dict]) -> list[dict]:
    """One record per paper, matched by DOI, arXiv id, Semantic Scholar id, OpenAlex id or normalised title."""
    index: dict[str, dict] = {}
    out: list[dict] = []
    for p in papers:
        keys = [f"doi:{p['doi']}" if p.get("doi") else None, f"arxiv:{p['arxiv_id']}" if p.get("arxiv_id") else None,
                f"s2:{p['s2_id']}" if p.get("s2_id") else None, f"oa:{p['oa_id']}" if p.get("oa_id") else None,
                f"t:{norm_title(p['title'])}" if p.get("title") else None]
        hit = next((index[k] for k in keys if k and k in index), None)
        if hit is None:
            hit = p
            out.append(p)
        else:
            merge(hit, p)
        for k in keys:
            if k:
                index[k] = hit
        # also index keys that only appeared after merging
        for k in [f"doi:{hit['doi']}" if hit.get("doi") else None, f"arxiv:{hit['arxiv_id']}" if hit.get("arxiv_id") else None,
                  f"s2:{hit['s2_id']}" if hit.get("s2_id") else None, f"oa:{hit['oa_id']}" if hit.get("oa_id") else None]:
            if k:
                index[k] = hit
    for p in out:
        p["id"] = paper_id(p)
        p["url"] = best_url(p)
    return out
