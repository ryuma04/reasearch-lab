"""Research Agent: Paper Reader (sub-agent 1.1) and Source Finder (sub-agent 1.2).

Output: the Research Brief (research/brief.md + research/brief.json), papers and claims in
the database (with page and position on the page for the PDF highlight) and paper/claims.json.
"""
from __future__ import annotations

import io
import json
import logging
import re
import tarfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

import httpx

from . import bus, db, llm, recipes
from .config import settings as cfg
from .observer import edge, node
from .project import pdir

log = logging.getLogger("lab.research")
HTTP = httpx.Client(timeout=httpx.Timeout(15.0, read=60.0), follow_redirects=True,
                    headers={"User-Agent": "tapu-sena-research-lab/1.0 (academic reproduction)"})

ARXIV_RE = re.compile(r"arxiv\.org/abs/([^\s?#]+)")


@dataclass
class PaperDoc:
    id: int
    title: str
    arxiv_id: str
    pdf_path: Path | None
    pages: list[str] = field(default_factory=list)
    latex: str = ""

    @property
    def text(self) -> str:
        return "\n".join(self.pages)

    def best_text(self, limit: int) -> str:
        """arXiv LaTeX source gives exact numbers and equations; fall back to PDF text."""
        if self.latex:
            return self.latex[:limit]
        out = []
        for i, p in enumerate(self.pages, 1):
            out.append(f"\n[page {i}]\n{p}")
        return "".join(out)[:limit]


# ---------- Paper Reader ----------

def acquire_papers(run_id: int, workspace_id: int) -> list[PaperDoc]:
    docs = []
    for up in db.q("SELECT * FROM uploads WHERE workspace_id=%s AND kind='paper' ORDER BY id", (workspace_id,)):
        paper = db.q1("SELECT * FROM papers WHERE upload_id=%s", (up["id"],))
        if not paper:
            paper = db.q1("INSERT INTO papers (workspace_id, upload_id) VALUES (%s,%s) RETURNING *", (workspace_id, up["id"]))
        pdir_ = cfg.data_dir / "workspaces" / str(workspace_id) / "papers"
        pdir_.mkdir(parents=True, exist_ok=True)
        arxiv_id, title, latex = paper["arxiv_id"], paper["title"], ""
        pdf_path: Path | None = None

        url = up["path_or_url"]
        m = ARXIV_RE.search(url)
        if m:
            arxiv_id = m.group(1)
            pdf_path = pdir_ / f"{paper['id']}.pdf"
            if not pdf_path.exists():
                bus.emit(run_id, "research.paper_reader", "progress", f"Downloading arXiv:{arxiv_id} (PDF and LaTeX source)",
                         "arXiv source files give exact equations and table numbers with no OCR mistakes")
                try:
                    resp = HTTP.get(f"https://arxiv.org/pdf/{arxiv_id}")
                    resp.raise_for_status()
                    pdf_path.write_bytes(resp.content)
                except httpx.HTTPError as e:
                    log.warning("arXiv PDF download failed: %s", e)
                    pdf_path = None
            latex_file = pdir_ / f"{paper['id']}.tex.txt"
            if latex_file.exists():
                latex = latex_file.read_text(encoding="utf-8", errors="ignore")
            else:
                latex = _arxiv_latex(arxiv_id)
                if latex:
                    latex_file.write_text(latex, encoding="utf-8")
            if not title:
                title = _arxiv_title(arxiv_id)
        elif not url.startswith("http"):
            pdf_path = cfg.data_dir / url

        pages = _pdf_pages(pdf_path) if pdf_path and pdf_path.exists() else []
        if not title:
            title = _guess_title(pages, up.get("original_name", ""))
        md_rel = f"workspaces/{workspace_id}/papers/{paper['id']}.md"
        (cfg.data_dir / md_rel).write_text("".join(f"\n<!-- page {i} -->\n{p}" for i, p in enumerate(pages, 1)), encoding="utf-8")
        pdf_rel = str(pdf_path.relative_to(cfg.data_dir).as_posix()) if pdf_path and pdf_path.exists() else ""
        db.ex("UPDATE papers SET title=%s, arxiv_id=%s, pdf_path=%s, parsed_markdown_path=%s WHERE id=%s",
              (title, arxiv_id, pdf_rel, md_rel, paper["id"]))
        docs.append(PaperDoc(id=paper["id"], title=title, arxiv_id=arxiv_id, pdf_path=pdf_path if pdf_rel else None,
                             pages=pages, latex=latex))
    return docs


def _arxiv_latex(arxiv_id: str) -> str:
    try:
        resp = HTTP.get(f"https://arxiv.org/e-print/{arxiv_id}")
        resp.raise_for_status()
        data = resp.content
    except httpx.HTTPError:
        return ""
    texts = []
    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:*") as tf:
            for m in tf.getmembers():
                if m.isfile() and m.name.endswith(".tex") and m.size < 2_000_000:
                    f = tf.extractfile(m)
                    if f:
                        texts.append(f.read().decode("utf-8", errors="ignore"))
    except tarfile.TarError:
        import gzip
        try:
            texts.append(gzip.decompress(data).decode("utf-8", errors="ignore"))
        except OSError:
            return ""
    return "\n".join(texts)


def _arxiv_title(arxiv_id: str) -> str:
    try:
        resp = HTTP.get("https://export.arxiv.org/api/query", params={"id_list": arxiv_id})
        root = ET.fromstring(resp.text)
        ns = {"a": "http://www.w3.org/2005/Atom"}
        t = root.find("a:entry/a:title", ns)
        return re.sub(r"\s+", " ", t.text).strip() if t is not None and t.text else ""
    except Exception:  # noqa: BLE001
        return ""


def _pdf_pages(path: Path) -> list[str]:
    try:
        import fitz  # PyMuPDF

        with fitz.open(path) as doc:
            return [p.get_text() for p in doc]
    except Exception as e:  # noqa: BLE001
        log.warning("PDF text extraction failed for %s: %s", path, e)
        return []


def _guess_title(pages: list[str], fallback: str) -> str:
    if pages:
        for line in pages[0].splitlines():
            line = line.strip()
            if 10 < len(line) < 200 and not line.lower().startswith(("arxiv", "http")):
                return line
    return re.sub(r"\.pdf$", "", fallback, flags=re.I) or "Untitled paper"


def locate(doc: PaperDoc, quotes: list[str], value: float | None = None) -> tuple[int | None, dict | None, str]:
    """Find a claim in the PDF: page number (1-based), rectangle on the page, and the matched text."""
    norm = lambda s: re.sub(r"\s+", " ", s).strip().lower()  # noqa: E731
    page_no, found = None, ""
    for q in [q for q in quotes if q]:
        for i, p in enumerate(doc.pages, 1):
            if norm(q) in norm(p):
                page_no, found = i, q
                break
        if page_no:
            break
    if not page_no and value is not None:
        v = str(int(value)) if float(value).is_integer() else str(value)
        for i, p in enumerate(doc.pages, 1):
            if re.search(rf"(?<![\d.]){re.escape(v)}(?![\d.])", p):
                page_no, found = i, v
                break
    if not page_no or not doc.pdf_path:
        return page_no, None, found
    try:
        import fitz

        with fitz.open(doc.pdf_path) as pdf:
            page = pdf[page_no - 1]
            rects = page.search_for(found) or (page.search_for(found.split()[0]) if found else [])
            if rects:
                r = rects[0]
                return page_no, {"x0": r.x0, "y0": r.y0, "x1": r.x1, "y1": r.y1,
                                 "page_width": page.rect.width, "page_height": page.rect.height}, found
    except Exception as e:  # noqa: BLE001
        log.warning("locate failed: %s", e)
    return page_no, None, found


def extract(run_id: int, doc: PaperDoc, note: str) -> dict:
    """Summary, method, settings, Claims List and Missing Details List for one paper."""
    recipe = recipes.find(doc.title, doc.arxiv_id, doc.text)
    existing = db.q("SELECT * FROM claims WHERE paper_id=%s ORDER BY id", (doc.id,))
    if recipe:
        info = {"title": recipe.TITLE, "summary": recipe.SUMMARY, "method": recipe.METHOD, "missing_details": recipe.MISSING,
                "field": recipe.FIELD, "recipe": recipe.NAME, "claims": [], "settings": []}
        claims_src = recipe.CLAIMS
    elif llm.available():
        info, claims_src = _extract_llm(doc, note)
    else:
        info, claims_src = _extract_heuristic(doc)

    if existing:  # the paper is read once; reuse its Claims List
        bus.emit(run_id, "research.paper_reader", "progress", f"Reusing the Claims List of '{doc.title}' ({len(existing)} claims)",
                 "The paper was already read in an earlier run; reading it again would waste AI quota")
        info["claims"] = existing
        return info

    saved = []
    for c in claims_src:
        try:
            value = float(c["value"])
        except (TypeError, ValueError, KeyError):
            continue
        quotes = c.get("quotes") or [c.get("quote", "")]
        page, pos, found = locate(doc, quotes, value)
        verified = bool(found) or not doc.pages
        if doc.pages and not found:
            log.info("claim not found in paper text, skipped: %s", c)
            continue
        row = db.q1("""INSERT INTO claims (paper_id, metric_name, description, value, unit, higher_is_better, tolerance,
                                           page, table_ref, position_on_page, condition, quote)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
                    (doc.id, _slug(c.get("metric_name") or c.get("description", "")), c.get("description", ""), value,
                     c.get("unit", ""), bool(c.get("higher_is_better", False)), float(c.get("tolerance", 0.10)),
                     page or c.get("page"), c.get("table_ref", ""), db.J(pos) if pos else None,
                     c.get("condition", "") + ("" if verified else " (not verified: paper text unavailable)"),
                     found or (quotes[0] if quotes else "")))
        saved.append(row)
    info["claims"] = saved
    db.ex("UPDATE papers SET title=%s, summary=%s WHERE id=%s", (info.get("title") or doc.title, info.get("summary", ""), doc.id))
    return info


def _slug(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")
    return s[:60] or "metric"


def _extract_llm(doc: PaperDoc, note: str) -> tuple[dict, list[dict]]:
    text = doc.best_text(120_000 if cfg.gemini_api_key else 24_000)
    data, _ = llm.chat_json("long",
        "You are the Paper Reader of an ML reproduction lab. Extract from the paper exactly what it states; never invent "
        "numbers. Return JSON with keys: title, summary (plain words, <=120 words), method (list of steps), field, "
        "settings (list of {name, value, page, quote}) using dotted snake_case names like train.lr, model.hidden, "
        "claims (list of {metric_name (snake_case key the code will write to metrics.json), description, value (number), "
        "unit, higher_is_better (bool), page, table_ref, condition, quote (exact text containing the number)}) for every "
        "main result the paper reports that could be reproduced on a CPU, missing_details (settings needed to "
        "reproduce that the paper does not state), datasets (list of names).",
        f"Researcher note: {note}\n\nPaper:\n{text}", max_tokens=6000)
    if not isinstance(data, dict):
        return _extract_heuristic(doc)
    claims = data.get("claims") or []
    for c in claims:
        c["quotes"] = [c.get("quote", "")]
    info = {k: data.get(k) for k in ("title", "summary", "method", "field", "missing_details", "datasets")}
    info["settings"] = data.get("settings") or []
    return info, claims


_CLAIM_RE = re.compile(r"([^.\n]{0,120}?(\d+(?:\.\d+)?)\s*(%|test errors|errors|accuracy|error rate|BLEU|F1)[^.\n]{0,80})", re.I)


def _extract_heuristic(doc: PaperDoc) -> tuple[dict, list[dict]]:
    """No AI available: pick sentences that report a result number."""
    claims, seen = [], set()
    for m in _CLAIM_RE.finditer(doc.text):
        sent, val, unit = m.group(1).strip(), m.group(2), m.group(3).lower()
        if val in seen or len(claims) >= 8:
            continue
        seen.add(val)
        claims.append({"metric_name": _slug(f"{unit} {len(claims) + 1}"), "description": sent[:160], "value": float(val),
                       "unit": unit, "higher_is_better": unit in ("%", "accuracy", "bleu", "f1"), "quotes": [m.group(0).strip()[:80]]})
    abstract = doc.text[:1500]
    info = {"title": doc.title, "summary": abstract[:600], "method": [], "field": "", "missing_details": [],
            "settings": [], "note": "No AI provider configured: claims were found by pattern matching and need review."}
    return info, claims


# ---------- Source Finder ----------

def find_sources(run_id: int, workspace_id: int, docs: list[PaperDoc], recipe) -> dict:
    out: dict = {"repositories": [], "datasets": [], "related_papers": [], "recommendation": ""}
    ups = db.q("SELECT * FROM uploads WHERE workspace_id=%s AND kind IN ('repo_link','dataset')", (workspace_id,))
    for up in ups:
        if up["kind"] == "repo_link":
            out["repositories"].append(_github_repo_info(up["path_or_url"], user_provided=True))
        else:
            out["datasets"].append(_dataset_info(up))
    if recipe and not any(d.get("user_provided") for d in out["datasets"]):
        out["datasets"].append({"name": "MNIST (torchvision)", "url": "https://pytorch.org/vision/stable/generated/torchvision.datasets.MNIST.html",
                                "official": True, "licence": "CC BY-SA 3.0", "size": "~12 MB", "fits_budget": True,
                                "how": "torchvision.datasets.MNIST(download=True)"})
    for d in docs:
        if not out["repositories"]:
            out["repositories"] += _search_github(d)
        out["related_papers"] += _related_papers(d)
    official = [r for r in out["repositories"] if r.get("official")]
    if recipe:
        out["recommendation"] = ("No official code is published for this paper; we recommend a clean re-implementation "
                                 "with the official dataset loader from torchvision.")
        if out["related_papers"]:
            out["recommendation"] += f" A newer related paper ('{out['related_papers'][0]['title']}') can be a what-if branch."
    elif official:
        out["recommendation"] = f"Official code found ({official[0]['url']}); study it and re-implement the parts needed."
    elif out["repositories"]:
        out["recommendation"] = "Community code exists but is not confirmed official; re-implement and use it only as a reference."
    else:
        out["recommendation"] = "No code found; re-implement from the paper."
    return out


def _github_repo_info(url: str, user_provided: bool = False) -> dict:
    m = re.search(r"github\.com/([^/\s]+)/([^/\s#?]+)", url)
    info = {"url": url, "user_provided": user_provided, "official": user_provided}
    if not m:
        return info
    try:
        resp = HTTP.get(f"https://api.github.com/repos/{m.group(1)}/{m.group(2).removesuffix('.git')}", timeout=10)
        if resp.status_code == 200:
            d = resp.json()
            info.update({"name": d.get("full_name"), "stars": d.get("stargazers_count"), "language": d.get("language"),
                         "licence": (d.get("license") or {}).get("spdx_id") or "none", "size_kb": d.get("size"),
                         "description": d.get("description") or "", "updated": d.get("pushed_at")})
    except httpx.HTTPError:
        pass
    return info


def _dataset_info(up: dict) -> dict:
    url = up["path_or_url"]
    info = {"name": up.get("original_name") or url.rsplit("/", 1)[-1], "url": url, "user_provided": True}
    if url.startswith("http"):
        try:
            resp = HTTP.head(url, timeout=10)
            size = int(resp.headers.get("content-length", 0))
            info["size"] = f"{size / 1e6:.1f} MB" if size else "unknown"
            info["fits_budget"] = size < 2e9
        except httpx.HTTPError:
            info["size"] = "unknown"
    else:
        info["size"] = f"{(up.get('size_bytes') or 0) / 1e6:.1f} MB"
        info["fits_budget"] = (up.get("size_bytes") or 0) < 2e9
    return info


def _search_github(doc: PaperDoc) -> list[dict]:
    if not doc.title:
        return []
    try:
        resp = HTTP.get("https://api.github.com/search/repositories",
                        params={"q": f'"{doc.title[:80]}" in:readme,description', "sort": "stars", "per_page": 3}, timeout=10)
        if resp.status_code != 200:
            return []
        items = resp.json().get("items", [])
    except httpx.HTTPError:
        return []
    out = []
    for it in items:
        readme_mentions = doc.arxiv_id and doc.arxiv_id in (it.get("description") or "")
        out.append({"url": it["html_url"], "name": it["full_name"], "stars": it["stargazers_count"],
                    "licence": (it.get("license") or {}).get("spdx_id") or "none", "official": bool(readme_mentions)})
    return out


def _related_papers(doc: PaperDoc) -> list[dict]:
    if not doc.arxiv_id:
        return []
    try:
        resp = HTTP.get(f"https://api.semanticscholar.org/graph/v1/paper/arXiv:{doc.arxiv_id.split('v')[0]}/citations",
                        params={"fields": "title,year,citationCount,externalIds", "limit": 50}, timeout=10)
        if resp.status_code != 200:
            return []
        cites = [c["citingPaper"] for c in resp.json().get("data", []) if c.get("citingPaper", {}).get("title")]
    except (httpx.HTTPError, ValueError):
        return []
    cites.sort(key=lambda p: p.get("citationCount") or 0, reverse=True)
    return [{"title": p["title"], "year": p.get("year"), "citations": p.get("citationCount"),
             "arxiv": (p.get("externalIds") or {}).get("ArXiv")} for p in cites[:3]]


# ---------- Research Brief ----------

def write_brief(run_id: int, workspace_id: int, papers_info: list[dict], sources: dict, docs: list[PaperDoc]) -> dict:
    root = pdir(run_id)
    brief = {"papers": [], "sources": sources}
    md = ["# Research Brief\n"]
    for info, doc in zip(papers_info, docs):
        claims = [{k: c[k] for k in ("id", "metric_name", "description", "value", "unit", "higher_is_better", "tolerance",
                                       "page", "table_ref", "condition", "quote") if k in c} for c in info["claims"]]
        brief["papers"].append({"paper_id": doc.id, "title": info.get("title") or doc.title, "arxiv_id": doc.arxiv_id,
                                "summary": info.get("summary", ""), "method": info.get("method") or [],
                                "field": info.get("field", ""), "missing_details": info.get("missing_details") or [],
                                "settings": info.get("settings") or [], "recipe": info.get("recipe"), "claims": claims})
        md.append(f"## {info.get('title') or doc.title}\n")
        if doc.arxiv_id:
            md.append(f"arXiv: {doc.arxiv_id}\n")
        md.append(f"**What the paper does.** {info.get('summary', '')}\n")
        if info.get("method"):
            md.append("**Method**\n\n" + "\n".join(f"{i}. {s}" for i, s in enumerate(info["method"], 1)) + "\n")
        md.append("**Claims List**\n\n| # | Claim | Value | Where |\n|---|---|---|---|")
        for i, c in enumerate(claims, 1):
            where = " ".join(x for x in [c.get("table_ref") or "", f"p.{c['page']}" if c.get("page") else ""] if x)
            md.append(f"| {i} | {c['description']} | {c['value']:g} {c.get('unit', '')} | {where} |")
        md.append("")
        if info.get("missing_details"):
            md.append("**Missing Details List** (not stated in the paper)\n\n" + "\n".join(f"- {m}" for m in info["missing_details"]) + "\n")
        if info.get("note"):
            md.append(f"> {info['note']}\n")
    md.append("## Sources found\n")
    for r in sources["repositories"]:
        md.append(f"- Code: {r.get('name') or r['url']} ({'official' if r.get('official') else 'not confirmed official'}, licence {r.get('licence', '?')})")
    for d in sources["datasets"]:
        md.append(f"- Dataset: {d['name']} ({d.get('size', '?')}{', licence ' + d['licence'] if d.get('licence') else ''})")
    for p in sources["related_papers"]:
        md.append(f"- Related newer paper: {p['title']} ({p.get('year')})")
    md.append(f"\n## Recommendation\n\n{sources['recommendation']}\n")
    text = "\n".join(md)
    write = lambda rel, s: ((root / rel).parent.mkdir(parents=True, exist_ok=True), (root / rel).write_text(s, encoding="utf-8"))  # noqa: E731
    write("research/brief.md", text)
    write("research/brief.json", json.dumps(brief, indent=2, default=str))
    write("paper/claims.json", json.dumps([c for p in brief["papers"] for c in p["claims"]], indent=2, default=str))
    db.ex("DELETE FROM notes WHERE workspace_id=%s AND run_id=%s AND author='research.paper_reader'", (workspace_id, run_id))
    db.ex("""INSERT INTO notes (workspace_id, run_id, author_type, author, title, markdown)
             VALUES (%s,%s,'agent','research.paper_reader',%s,%s)""", (workspace_id, run_id, f"Research Brief (run #{run_id})", text))
    return brief


def map_for_brief(brief: dict) -> tuple[list, list]:
    nodes, edges = [], []
    for p in brief["papers"]:
        pid = f"paper:{p['paper_id']}"
        nodes.append(node(pid, "paper", p["title"][:60]))
        for c in p["claims"]:
            cid = f"claim:{c['id']}"
            nodes.append(node(cid, "claim", f"{c['description'][:40]}: {c['value']:g}", "waiting", page=c.get("page")))
            edges.append(edge(pid, cid, "claims"))
    for i, d in enumerate(brief["sources"]["datasets"]):
        nodes.append(node(f"dataset:{i}", "source", d["name"][:40]))
        for p in brief["papers"]:
            edges.append(edge(f"dataset:{i}", f"paper:{p['paper_id']}", "used by"))
    for i, r in enumerate(brief["sources"]["repositories"]):
        nodes.append(node(f"repo:{i}", "source", (r.get("name") or r["url"])[:40]))
    return nodes, edges
