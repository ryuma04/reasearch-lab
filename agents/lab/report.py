"""Research & Planning report: Markdown, JSON and PDF, all generated from the SAME persisted data
(research/brief.json, the run's settings and the plan checkpoint), never from frontend state.

Only what exists is written. A missing section is omitted or marked "not available", never invented.
"""
from __future__ import annotations

import html
import io
import json
import re
from typing import Any

from . import db
from .project import pdir

_LINK = re.compile(r"\[([^\]]+)\]\((https?://[^\s)]+)\)")


def _safe_url(u: Any) -> str | None:
    return u if isinstance(u, str) and re.match(r"^https?://[^\s]+$", u) and "@" not in u.split("/")[2] else None


def _link(text: str, url: Any) -> str:
    u = _safe_url(url)
    return f"[{text}]({u})" if u else text


def collect(run_id: int) -> dict:
    """Everything the report needs, read from the database and the run's project folder."""
    run = db.q1("SELECT r.id, r.status, r.stage, r.compute_budget, r.created_at, w.title AS workspace "
                "FROM runs r JOIN workspaces w ON w.id=r.workspace_id WHERE r.id=%s", (run_id,))
    brief = None
    path = pdir(run_id) / "research" / "brief.json"
    if path.exists():
        try:
            brief = json.loads(path.read_text(encoding="utf-8"))
        except ValueError:
            brief = None
    settings = db.q("SELECT name, value, source, source_ref, reason, paper_value FROM settings WHERE run_id=%s ORDER BY name", (run_id,))
    plan = db.q1("SELECT status, payload, response, created_at, resolved_at FROM checkpoints WHERE run_id=%s AND name='plan' ORDER BY id DESC LIMIT 1", (run_id,))
    return {"run": run, "brief": brief, "settings": settings, "plan": plan}


def build_doc(data: dict) -> list[tuple]:
    """A small block model: ('h1'|'h2'|'p'|'ul'|'table', ...). Inline links use Markdown [text](url)."""
    run, brief, settings, plan = data["run"] or {}, data["brief"], data["settings"], data["plan"]
    doc: list[tuple] = [("h1", f"Research & Planning report: {run.get('workspace', 'workspace')}"),
                        ("p", f"Run #{run.get('id')} · status: {run.get('status')} · compute budget: {run.get('compute_budget')}")]
    if not brief:
        doc.append(("p", "The Research Brief is not available yet: the research agents have not finished or no brief was written."))
    else:
        for p in brief.get("papers", []):
            doc.append(("h2", p.get("title") or "Paper"))
            arxiv = (p.get("arxiv_id") or "").split("v")[0]
            if arxiv:
                doc.append(("p", f"Source: {_link('arXiv:' + arxiv, f'https://arxiv.org/abs/{arxiv}')}"))
            if p.get("summary"):
                doc.append(("h3", "Summary"))
                doc.append(("p", p["summary"]))
            if p.get("method"):
                doc.append(("h3", "Methods and technical approach"))
                doc.append(("ul", [str(m) for m in p["method"]]))
            claims = p.get("claims") or []
            if claims:
                doc.append(("h3", "Key findings (claims reported by the paper)"))
                rows = [[c["description"], f"{c['value']:g}{(' ' + c['unit']) if c.get('unit') else ''}",
                         " ".join(x for x in [c.get("table_ref") or "", f"p.{c['page']}" if c.get("page") else ""] if x) or "not located",
                         c.get("quote") or ""] for c in claims]
                doc.append(("table", ["Claim", "Value", "Where", "Quote from the paper"], rows))
            if p.get("missing_details"):
                doc.append(("h3", "Limitations and uncertainties (details the paper does not state)"))
                doc.append(("ul", [str(m) for m in p["missing_details"]]))
        src = brief.get("sources") or {}
        datasets, repos, related = src.get("datasets") or [], src.get("repositories") or [], src.get("related_papers") or []
        if datasets or repos or related:
            doc.append(("h2", "Sources"))
        if datasets:
            doc.append(("h3", "Datasets"))
            doc.append(("ul", [f"{_link(d['name'], d.get('url'))}" + (f" · {d['size']}" if d.get("size") else "") + (f" · licence {d['licence']}" if d.get("licence") else "") for d in datasets]))
        if repos:
            doc.append(("h3", "Code repositories"))
            doc.append(("ul", [f"{_link(r.get('name') or r.get('url', 'repository'), r.get('url'))} · " +
                               ("provided by the researcher" if r.get("user_provided") else "official" if r.get("official") else "found by title search, not confirmed official") for r in repos]))
        if related:
            doc.append(("h3", "Related work (papers citing this paper)"))
            items = []
            for r in related:
                a = r.get("arxiv")
                items.append(f"{_link(r['title'], f'https://arxiv.org/abs/{a}' if a else None)}" + (f" ({r['year']})" if r.get("year") else "") +
                             (f" · {r['citations']} citations" if r.get("citations") is not None else ""))
            doc.append(("ul", items))
        if src.get("recommendation"):
            doc.append(("h2", "Recommendation"))
            doc.append(("p", src["recommendation"]))

    doc.append(("h2", "Coding Plan"))
    if not plan:
        doc.append(("p", "The coding plan has not been produced yet."))
    else:
        status = {"pending": "waiting for approval", "approved": "approved", "edited": "approved with edits", "rejected": "rejected"}.get(plan["status"], plan["status"])
        doc.append(("p", f"Status: {status}" + (f" · decided {plan['resolved_at']:%Y-%m-%d %H:%M}" if plan.get("resolved_at") else "")))
        draft = (plan.get("payload") or {}).get("draft") or {}
        changes = draft.get("changes") or {}
        if settings:
            rows = []
            for s in settings:
                shown = changes.get(s["name"], s["value"]) if plan["status"] == "pending" else s["value"]
                rows.append([s["name"], str(shown) + (" (unsaved draft edit)" if plan["status"] == "pending" and s["name"] in changes else ""),
                             s["source"], s.get("reason") or s.get("source_ref") or ""])
            doc.append(("table", ["Setting", "Value", "Source", "Reason / evidence"], rows))
        if draft.get("note"):
            doc.append(("p", f"Researcher's note for the agents: {draft['note']}"))
    return doc


def to_markdown(doc: list[tuple]) -> str:
    out: list[str] = []
    for b in doc:
        k = b[0]
        if k in ("h1", "h2", "h3"):
            out.append(f"{'#' * int(k[1])} {b[1]}\n")
        elif k == "p":
            out.append(f"{b[1]}\n")
        elif k == "ul":
            out.append("\n".join(f"- {i}" for i in b[1]) + "\n")
        elif k == "table":
            esc = lambda v: str(v).replace("|", "\\|").replace("\n", " ")  # noqa: E731
            out.append("| " + " | ".join(b[1]) + " |\n|" + "---|" * len(b[1]) + "\n" +
                       "\n".join("| " + " | ".join(esc(c) for c in row) + " |" for row in b[2]) + "\n")
    return "\n".join(out)


def _inline_html(text: str) -> str:
    parts, last = [], 0
    for m in _LINK.finditer(text):
        parts.append(html.escape(text[last:m.start()]))
        parts.append(f'<a href="{html.escape(m.group(2), quote=True)}">{html.escape(m.group(1))}</a>')
        last = m.end()
    parts.append(html.escape(text[last:]))
    return "".join(parts)


def to_html(doc: list[tuple]) -> str:
    out = []
    for b in doc:
        k = b[0]
        if k in ("h1", "h2", "h3"):
            out.append(f"<{k}>{_inline_html(b[1])}</{k}>")
        elif k == "p":
            out.append(f"<p>{_inline_html(b[1])}</p>")
        elif k == "ul":
            out.append("<ul>" + "".join(f"<li>{_inline_html(i)}</li>" for i in b[1]) + "</ul>")
        elif k == "table":
            head = "".join(f"<th>{html.escape(h)}</th>" for h in b[1])
            rows = "".join("<tr>" + "".join(f"<td>{_inline_html(str(c))}</td>" for c in r) + "</tr>" for r in b[2])
            out.append(f"<table><tr>{head}</tr>{rows}</table>")
    return "\n".join(out)


_CSS = """
body { font-family: sans-serif; font-size: 10pt; line-height: 1.4; }
h1 { font-size: 18pt; } h2 { font-size: 14pt; margin-top: 14pt; } h3 { font-size: 11pt; margin-top: 8pt; }
a { color: #4b3fd1; }
table { width: 100%; border-collapse: collapse; margin: 6pt 0; }
th, td { border: 0.5pt solid #bbbbbb; padding: 3pt; font-size: 9pt; text-align: left; }
th { background-color: #eeeeee; }
"""


def to_pdf(doc: list[tuple]) -> bytes:
    import fitz  # PyMuPDF
    story = fitz.Story(html=to_html(doc), user_css=_CSS)
    media = fitz.paper_rect("a4")
    where = media + (48, 48, -48, -48)

    def rectfn(rect_num, filled):  # one text box per A4 page; Story paginates automatically
        return media, where, None

    pdf = story.write_with_links(rectfn)  # a PDF whose <a href> links are real, clickable link annotations
    try:
        return pdf.tobytes(garbage=3, deflate=True)
    finally:
        pdf.close()


def to_json(data: dict, doc: list[tuple]) -> str:
    out = {"run": data["run"], "brief": data["brief"], "settings": data["settings"],
           "plan": data["plan"], "sections": [{"type": b[0], "content": b[1:]} for b in doc]}
    return json.dumps(out, indent=2, default=str, ensure_ascii=False)


def render(run_id: int, fmt: str) -> tuple[bytes, str, str]:
    """Returns (body, content type, file name)."""
    data = collect(run_id)
    if not data["run"]:
        raise LookupError("run not found")
    doc = build_doc(data)
    base = f"research-report-run-{run_id}"
    if fmt == "md":
        return to_markdown(doc).encode("utf-8"), "text/markdown; charset=utf-8", base + ".md"
    if fmt == "json":
        return to_json(data, doc).encode("utf-8"), "application/json", base + ".json"
    if fmt == "pdf":
        return to_pdf(doc), "application/pdf", base + ".pdf"
    raise ValueError("format must be md, json or pdf")
