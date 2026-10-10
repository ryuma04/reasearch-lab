"""Code-source assessment for the Source Finder.

The repository the researcher supplied stays the reference. Alternatives are discovered on GitHub and on
the Hugging Face Hub (models and Spaces), and every candidate, the original included, is judged by the
same criteria computed from evidence that was actually fetched: relevance to the paper, documentation,
completeness, maintenance and compatibility with the lab's Python sandbox. Popularity (stars, downloads,
likes) is shown but carries no weight. An alternative is only called better when it is relevant, wins on
several criteria and clears a clear margin; otherwise the result says so honestly.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

import httpx

log = logging.getLogger("lab.sources")

GH = "https://api.github.com"
HF = "https://huggingface.co"
MAX_PER_SOURCE = 3
MARGIN = 12                # points an alternative must beat the original by
MIN_WINS = 2               # and it must be strictly better on at least this many criteria
MIN_RELEVANCE = 20         # mentions the paper by title or arXiv id
HTTP = httpx.Client(timeout=httpx.Timeout(10.0, read=20.0), follow_redirects=True,
                    headers={"User-Agent": "tapu-sena-research-lab/1.0 (academic reproduction)"})

CRITERIA = (("relevance", "Relevance to the paper", 30), ("documentation", "Documentation", 15),
            ("completeness", "Completeness", 25), ("maintenance", "Maintenance", 15),
            ("compatibility", "Compatibility with a Python/PyTorch sandbox", 15))
WEIGHTS_EXT = (".safetensors", ".bin", ".pt", ".pth", ".ckpt", ".h5", ".onnx", ".gguf", ".msgpack")
PY_LIBS = {"pytorch", "transformers", "timm", "sklearn", "scikit-learn", "keras", "tensorflow", "jax", "diffusers", "sentence-transformers"}


# ---------- URL handling ----------

def parse_repo_url(url: str) -> dict | None:
    """Normalise a researcher-supplied link to {host, kind, id, url}; None if it is not a supported code host."""
    s = (url or "").strip()
    m = re.search(r"github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)", s)
    if m:
        name = m.group(2).removesuffix(".git")
        return {"host": "github", "kind": "repo", "id": f"{m.group(1)}/{name}", "url": f"https://github.com/{m.group(1)}/{name}"}
    m = re.search(r"huggingface\.co/(?:(spaces|datasets)/)?([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)", s)
    if m:
        kind = {"spaces": "space", "datasets": "dataset"}.get(m.group(1) or "", "model")
        prefix = {"space": "spaces/", "dataset": "datasets/", "model": ""}[kind]
        return {"host": "huggingface", "kind": kind, "id": f"{m.group(2)}/{m.group(3)}", "url": f"{HF}/{prefix}{m.group(2)}/{m.group(3)}"}
    return None


# ---------- fetching ----------

class Fetch:
    """Records what could not be fetched so a missing signal is reported, never silently scored as bad."""

    def __init__(self) -> None:
        self.limits: list[str] = []

    def json(self, url: str, params: dict | None = None):
        try:
            r = HTTP.get(url, params=params, headers={"Accept": "application/json"})
        except httpx.HTTPError as e:
            self.limits.append(f"Network error contacting {url.split('/')[2]}: {type(e).__name__}")
            return None
        if r.status_code in (403, 429) and r.headers.get("x-ratelimit-remaining") == "0":
            self.limits.append("GitHub API rate limit reached; some evidence could not be fetched")
            return None
        if r.status_code != 200:
            if r.status_code not in (404,):
                self.limits.append(f"{url.split('/')[2]} answered {r.status_code} for {url.split('?')[0][-60:]}")
            return None
        try:
            return r.json()
        except ValueError:
            return None

    def text(self, url: str, headers: dict | None = None) -> str:
        try:
            r = HTTP.get(url, headers=headers or {})
        except httpx.HTTPError:
            return ""
        return r.text[:20000] if r.status_code == 200 else ""


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def _age_years(iso: str | None) -> float | None:
    if not iso:
        return None
    try:
        d = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None
    return max(0.0, (datetime.now(timezone.utc) - d).days / 365.25)


def _github(f: Fetch, full_name: str, user_provided: bool) -> dict:
    c = {"host": "github", "kind": "repo", "id": full_name, "url": f"https://github.com/{full_name}", "name": full_name,
         "user_provided": user_provided, "fetched": False, "readme": "", "files": [], "tags": []}
    d = f.json(f"{GH}/repos/{full_name}")
    if not d:
        return c
    c.update(fetched=True, description=d.get("description") or "", language=d.get("language") or "", archived=bool(d.get("archived")),
             updated=d.get("pushed_at"), licence=(d.get("license") or {}).get("spdx_id") or "none", stars=d.get("stargazers_count"))
    c["readme"] = f.text(f"{GH}/repos/{full_name}/readme", {"Accept": "application/vnd.github.raw"})
    root = f.json(f"{GH}/repos/{full_name}/contents/")
    if isinstance(root, list):
        c["files"] = [str(x.get("name", "")) for x in root][:200]
    return c


def _hf(f: Fetch, kind: str, hid: str, user_provided: bool) -> dict:
    seg = {"model": "models", "space": "spaces", "dataset": "datasets"}[kind]
    prefix = {"model": "", "space": "spaces/", "dataset": "datasets/"}[kind]
    c = {"host": "huggingface", "kind": kind, "id": hid, "url": f"{HF}/{prefix}{hid}", "name": hid,
         "user_provided": user_provided, "fetched": False, "readme": "", "files": [], "tags": []}
    d = f.json(f"{HF}/api/{seg}/{hid}")
    if not d:
        return c
    tags = [str(t) for t in d.get("tags") or []]
    card = d.get("cardData") or {}
    lic = next((t.split(":", 1)[1] for t in tags if t.startswith("license:")), "") or str(card.get("license") or "")
    c.update(fetched=True, description=str(card.get("description") or d.get("pipeline_tag") or ""), tags=tags,
             language="Python" if d.get("library_name") or "pytorch" in tags else "", library=d.get("library_name") or "",
             updated=d.get("lastModified"), licence=lic or "none", stars=d.get("likes"), downloads=d.get("downloads"),
             files=[str(s.get("rfilename", "")) for s in d.get("siblings") or []][:300])
    c["readme"] = f.text(f"{HF}/{prefix}{hid}/raw/main/README.md")
    return c


# ---------- discovery ----------

def discover(f: Fetch, title: str, arxiv_id: str) -> list[dict]:
    """Candidate code sources for the paper from GitHub and the Hugging Face Hub (unranked, up to a small cap)."""
    seen: dict[str, tuple[str, str]] = {}
    aid = (arxiv_id or "").split("v")[0]

    def add(host: str, kind: str, hid: str) -> None:
        seen.setdefault(f"{host}:{kind}:{hid.lower()}", (kind, hid))

    gh_queries = ([f'"{aid}" in:readme'] if aid else []) + ([f'"{title[:80]}" in:readme,description'] if title else [])
    for q in gh_queries:
        data = f.json(f"{GH}/search/repositories", {"q": q, "per_page": MAX_PER_SOURCE})
        for it in (data or {}).get("items", [])[:MAX_PER_SOURCE]:
            add("github", "repo", it["full_name"])
    if aid:
        paper = f.json(f"{HF}/api/papers/{aid}") or {}
        m = parse_repo_url(str(paper.get("githubRepo") or ""))
        if m and m["host"] == "github":
            add("github", "repo", m["id"])
        for it in (f.json(f"{HF}/api/models", {"filter": f"arxiv:{aid}", "sort": "downloads", "direction": -1, "limit": MAX_PER_SOURCE}) or [])[:MAX_PER_SOURCE]:
            add("huggingface", "model", it.get("id", ""))
    if title:
        for it in (f.json(f"{HF}/api/models", {"search": title[:80], "sort": "downloads", "direction": -1, "limit": MAX_PER_SOURCE}) or [])[:MAX_PER_SOURCE]:
            add("huggingface", "model", it.get("id", ""))
        for it in (f.json(f"{HF}/api/spaces", {"search": title[:80], "limit": 2}) or [])[:2]:
            add("huggingface", "space", it.get("id", ""))
    out = []
    for key, (kind, hid) in list(seen.items())[:8]:
        if not hid:
            continue
        out.append(_github(f, hid, False) if key.startswith("github:") else _hf(f, kind, hid, False))
    return out


# ---------- evaluation (same criteria for every candidate) ----------

def evaluate(c: dict, title: str, arxiv_id: str) -> dict:
    """Attach {score, criteria[], mentions_paper, evidence_complete} computed from fetched evidence only."""
    aid = (arxiv_id or "").split("v")[0]
    blob = " ".join([c.get("readme", ""), c.get("description", ""), " ".join(c.get("tags", []))])
    has_id = bool(aid) and re.search(rf"{re.escape(aid)}(v\d+)?", blob) is not None
    has_title = len(_norm(title)) >= 12 and _norm(title) in _norm(blob)
    files = [x.lower() for x in c.get("files", [])]
    crit: list[dict] = []

    def add(key: str, points: int, notes: list[str]) -> None:
        label, mx = next((l, m) for k, l, m in CRITERIA if k == key)
        crit.append({"key": key, "label": label, "points": min(points, mx), "max": mx, "evidence": notes})

    if not c.get("fetched"):
        for key, label, mx in CRITERIA:
            crit.append({"key": key, "label": label, "points": 0, "max": mx, "evidence": ["could not be fetched, so nothing is credited"]})
        c.update(score=0, criteria=crit, mentions_paper=False, evidence_complete=False)
        return c

    rel = 30 if has_id else 20 if has_title else 0
    add("relevance", rel, ["Cites the paper's arXiv id" if has_id else "Names the paper's title" if has_title else "Does not mention the paper by title or arXiv id"])

    doc, n = 0, []
    rl = len(c.get("readme", ""))
    if rl >= 1500: doc += 8; n.append(f"README of {rl} characters")
    elif rl >= 300: doc += 4; n.append(f"Short README ({rl} characters)")
    else: n.append("No usable README")
    low = c.get("readme", "").lower()
    if re.search(r"\b(install|usage|quick ?start|getting started|example)\b", low): doc += 4; n.append("Explains installation or usage")
    if re.search(r"\b(results|citation|cite|benchmark|evaluation)\b", low): doc += 3; n.append("Reports results or how to cite")
    add("documentation", doc, n)

    comp, n = 0, []
    if c["host"] == "github":
        if any(x in files for x in ("requirements.txt", "setup.py", "pyproject.toml", "environment.yml")): comp += 6; n.append("Declares dependencies")
        if any(x.startswith(("train", "main", "run")) or x in ("src", "scripts", "experiments") for x in files): comp += 8; n.append("Has training or run code")
        if any(x in ("tests", "test") or x.startswith("test_") for x in files): comp += 4; n.append("Has tests")
        if c.get("licence") not in ("", "none", "NOASSERTION"): comp += 3; n.append(f"Licence {c['licence']}")
        if any(x.endswith(".ipynb") or x in ("examples", "notebooks", "demo") for x in files): comp += 4; n.append("Has examples or notebooks")
    else:
        if any(x.endswith(WEIGHTS_EXT) for x in files): comp += 12; n.append("Ships model weights")
        if any(x in ("config.json", "README.md") for x in files): comp += 5; n.append("Has a config or model card")
        if c.get("licence") not in ("", "none"): comp += 4; n.append(f"Licence {c['licence']}")
        if c.get("library"): comp += 4; n.append(f"Library: {c['library']}")
    add("completeness", comp, n or ["No completeness signal found"])

    age, n = _age_years(c.get("updated")), []
    mt = 0 if age is None else 15 if age <= 1 else 8 if age <= 2 else 4 if age <= 3 else 0
    n.append("Last update unknown" if age is None else f"Updated {age:.1f} years ago")
    if c.get("archived"): mt = 0; n.append("Repository is archived")
    add("maintenance", mt, n)

    lang = (c.get("language") or "").lower()
    py = lang == "python" or bool(PY_LIBS & {c.get("library", "").lower(), *c.get("tags", [])})
    add("compatibility", 15 if py else 5 if lang else 0, ["Python / PyTorch ecosystem" if py else f"Written in {c['language']}" if lang else "Language not stated"])

    c.update(score=sum(x["points"] for x in crit), criteria=crit, mentions_paper=rel > 0,
             evidence_complete=bool(c.get("readme")) and (c["host"] == "huggingface" or bool(c.get("files"))))
    return c


def _public(c: dict) -> dict:
    """The part of a candidate that is stored and shown (no README body or file dump)."""
    keys = ("url", "name", "host", "kind", "user_provided", "fetched", "description", "language", "licence", "updated", "archived",
            "stars", "downloads", "score", "criteria", "mentions_paper", "evidence_complete")
    return {k: c[k] for k in keys if k in c}


# ---------- decision ----------

def decide(original: dict | None, alternatives: list[dict], limits: list[str]) -> dict:
    """Verdict, the recommended alternative (if one is justified) and a like-for-like comparison."""
    relevant = [a for a in alternatives if a.get("fetched") and a.get("mentions_paper")]
    res: dict = {"verdict": "no_alternative_found", "recommended": None, "comparison": [], "advantages": [], "tradeoffs": [],
                 "confidence": "none", "limitations": sorted(set(limits)), "summary": ""}
    if original is not None and not original.get("fetched"):
        res.update(verdict="insufficient_evidence", summary=f"The supplied repository ({original['url']}) could not be read, so it cannot be compared with alternatives.")
        res["limitations"].append("Original repository metadata was unavailable")
        return res
    if not relevant:
        if original is None:
            res["summary"] = "No code source that cites this paper was found; re-implement from the paper."
        else:
            res.update(verdict="no_better_alternative", confidence="medium" if original.get("evidence_complete") and not limits else "low",
                       summary=f"No stronger alternative was established: no other relevant code source was found for this paper. Your repository ({original['url']}) remains the reference.")
        return res
    best = max(relevant, key=lambda a: a["score"])
    if original is None:
        res.update(verdict="suggested_source", recommended=_public(best), confidence="medium" if best["evidence_complete"] else "low",
                   summary=f"No repository was supplied. The most relevant code source found is {best['url']} (score {best['score']}/100 on relevance, documentation, completeness, maintenance and compatibility); review it before relying on it.")
        return res
    ocrit = {x["key"]: x for x in original["criteria"]}
    wins = lambda a: sum(1 for x in a["criteria"] if x["points"] > ocrit[x["key"]]["points"])  # noqa: E731
    qualifying = [a for a in relevant if a["evidence_complete"] and a["score"] >= original["score"] + MARGIN
                  and wins(a) >= MIN_WINS and a["criteria"][0]["points"] >= MIN_RELEVANCE]
    cand = max(qualifying, key=lambda a: a["score"]) if qualifying else best
    comp = [{"criterion": x["label"], "original": ocrit[x["key"]]["points"], "alternative": x["points"], "max": x["max"],
             "original_evidence": ocrit[x["key"]]["evidence"], "alternative_evidence": x["evidence"]} for x in cand["criteria"]]
    adv = [f"{x['criterion']}: {'; '.join(x['alternative_evidence'])}" for x in comp if x["alternative"] > x["original"]]
    trade = [f"{x['criterion']}: {'; '.join(x['alternative_evidence'])}" for x in comp if x["alternative"] < x["original"]]
    res.update(comparison=comp, advantages=adv, tradeoffs=trade, recommended=_public(cand))
    if qualifying:
        big = cand["score"] >= original["score"] + 2 * MARGIN and cand["criteria"][0]["points"] == 30 and original.get("evidence_complete")
        res.update(verdict="better_alternative", confidence="high" if big and not limits else "medium",
                   summary=f"{cand['url']} scored {cand['score']}/100 against {original['score']}/100 for your repository, ahead on {wins(cand)} of 5 criteria. Your repository stays the reference; consider the alternative for what it does better.")
    else:
        res.update(verdict="interesting_alternative", confidence="low",
                   summary=f"{cand['url']} is relevant ({cand['score']}/100 against {original['score']}/100 for your repository) but not demonstrably better, so it is shown for reference only. No stronger alternative was established.")
    return res


def assess(title: str, arxiv_id: str, user_urls: list[str]) -> dict:
    """Keep the researcher's repositories, find alternatives and compare them like for like."""
    f = Fetch()
    originals = []
    for u in user_urls:
        p = parse_repo_url(u)
        if not p:
            originals.append({"url": u, "name": u, "host": "other", "user_provided": True, "fetched": False, "criteria": [], "score": 0,
                              "mentions_paper": False, "evidence_complete": False, "readme": "", "files": [], "tags": []})
            continue
        originals.append(_github(f, p["id"], True) if p["host"] == "github" else _hf(f, p["kind"], p["id"], True))
    for o in originals:
        if o["host"] != "other":
            evaluate(o, title, arxiv_id)
    orig_urls = {o["url"].lower() for o in originals}
    alts = [evaluate(a, title, arxiv_id) for a in discover(f, title, arxiv_id) if a["url"].lower() not in orig_urls]
    alts.sort(key=lambda a: a.get("score", 0), reverse=True)
    primary = originals[0] if originals else None
    res = decide(primary, alts, f.limits)
    res["original"] = [_public(o) for o in originals]
    res["alternatives"] = [_public(a) for a in alts]
    res["criteria_note"] = ("Every candidate, the original included, is scored 0-100 on relevance (30), documentation (15), completeness (25), "
                            "maintenance (15) and compatibility (15) from fetched evidence. Stars and downloads are shown but not counted.")
    return res
