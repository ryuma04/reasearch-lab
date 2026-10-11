"""Read a paper PDF: page text, figures/tables (cropped from the page with their captions) and display equations.

Nothing here is generated: figures and equations are pixel crops of the PDF itself, and equation LaTeX is used only
when it comes verbatim from the paper's own arXiv source. The script writer may only pick from these items by id.
"""
from __future__ import annotations

import logging
import re
from collections import Counter
from dataclasses import asdict, dataclass, field
from pathlib import Path

import pymupdf

log = logging.getLogger("lab.explainer.extract")

CAPTION_RE = re.compile(r"^\s*(Figure|Fig\.|Table)\s*(\d+)\s*[.:|]", re.I)
EQ_NUM_RE = re.compile(r"\((\d{1,3})\)\s*$")
MATH_FONT_RE = re.compile(r"CMMI|CMSY|CMEX|MSBM|MSAM|Math|Symbol|STIX|LMMath|rsfs|eufm|Cambria Math|CMBSY|txsy|txmi|NimbusRomNo9L-ReguItal", re.I)
MATH_CHARS = set("=+−-×·∑∏∫√∂∇≈≤≥≠∈∀∃→←⇒αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΦΨΩ^_|‖∥⊙⊗∗")
NAME_RE = re.compile(r"^[A-Z][a-zA-Z'\-]+\.?(?: [A-Z][a-zA-Z'\-]*\.?){1,3}$")
AFFIL_RE = re.compile(r"\b(code|street|road|avenue|city|state|states|united|kingdom|china|usa|jolla|campus|center|centre|faculty|email|mail)\b", re.I)
ARXIV_STAMP_RE = re.compile(r"arXiv:(\d{4}\.\d{4,5})(v\d+)?")


@dataclass
class Figure:
    id: str
    page: int
    kind: str          # figure | table
    number: str
    caption: str
    file: str          # relative to the job's public dir
    aspect: float
    label: str


@dataclass
class Equation:
    id: str
    page: int
    number: str
    text: str          # the equation as extracted text (for the script writer to read)
    file: str          # crop of the PDF, relative to the public dir
    aspect: float
    label: str
    latex: str = ""    # verbatim from the arXiv source when we can match it


@dataclass
class PaperContent:
    title: str
    authors: str
    arxiv_id: str
    pages: list[str]
    figures: list[Figure] = field(default_factory=list)
    equations: list[Equation] = field(default_factory=list)
    latex_equations: list[str] = field(default_factory=list)
    macros: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {"title": self.title, "authors": self.authors, "arxiv_id": self.arxiv_id, "page_count": len(self.pages),
                "figures": [asdict(f) for f in self.figures], "equations": [asdict(e) for e in self.equations],
                "latex_equation_count": len(self.latex_equations)}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def _block_text(b: dict) -> str:
    return _norm(" ".join("".join(s["text"] for s in ln["spans"]) for ln in b.get("lines", [])))


def _math_ratio(spans: list[dict]) -> float:
    total = sum(len(s["text"].strip()) for s in spans) or 1
    mathy = sum(len(s["text"].strip()) for s in spans if MATH_FONT_RE.search(s.get("font", "")))
    mathy += sum(1 for s in spans if not MATH_FONT_RE.search(s.get("font", "")) for ch in s["text"] if ch in MATH_CHARS)
    return min(1.0, mathy / total)


def _center(r: pymupdf.Rect) -> pymupdf.Point:
    return pymupdf.Point((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2)


def _save_crop(page: pymupdf.Page, rect: pymupdf.Rect, out: Path, dpi: int) -> float:
    pix = page.get_pixmap(clip=rect, dpi=dpi, alpha=False)
    out.parent.mkdir(parents=True, exist_ok=True)
    pix.save(str(out))
    return round(pix.width / max(1, pix.height), 3)


def _title_and_authors(doc: pymupdf.Document) -> tuple[str, str]:
    """Largest text on page 1 is the title; the next short block under it usually lists the authors."""
    meta_title = _norm((doc.metadata or {}).get("title") or "")
    page = doc[0]
    blocks = [b for b in page.get_text("dict")["blocks"] if b.get("type") == 0]
    best, size = None, 0.0
    for b in blocks:
        if b["bbox"][1] > page.rect.height * 0.5:
            continue
        for ln in b["lines"]:
            for s in ln["spans"]:
                if s["text"].strip() and s["size"] > size and len(s["text"].strip()) > 3 and not ARXIV_STAMP_RE.search(s["text"]):
                    best, size = b, s["size"]
    title = ""
    if best is not None:
        # The title may wrap into following blocks set in the same size; take them all, in reading order.
        parts = []
        for b in blocks:
            if b["bbox"][1] > page.rect.height * 0.5 or b["bbox"][1] < best["bbox"][1] - 2:
                continue
            txt = _norm(" ".join("".join(s["text"] for s in ln["spans"] if s["size"] >= size - 0.6) for ln in b["lines"]))
            if txt and not ARXIV_STAMP_RE.search(txt):
                if b["bbox"][1] > best["bbox"][3] + size * 1.6 and parts:
                    break
                parts.append(txt)
                best = b
        title = _norm(" ".join(parts))
    if len(meta_title) > 12 and not meta_title.lower().endswith((".pdf", ".dvi", ".tex")) and (not title or len(title) < 8):
        title = meta_title
    authors = ""
    if best is not None:
        top = best["bbox"][3] - 1
        stop = min([b["bbox"][1] for b in blocks if b["bbox"][1] > top and re.match(r"\s*abstract\b", _block_text(b), re.I)] + [top + 220])
        names = []
        flat = [b for b in blocks if top <= b["bbox"][1] < stop and (b["bbox"][2] - b["bbox"][0]) > 40 and not ARXIV_STAMP_RE.search(_block_text(b))]
        for b in sorted(flat, key=lambda b: (round(b["bbox"][1] / 20), b["bbox"][0])):
            first = _norm("".join(s["text"] for s in b["lines"][0]["spans"]))
            first = re.sub(r"[\d∗*†‡§¶]+", "", first).strip(" ,")
            if not first or "@" in first or len(first) > 60 or re.search(r"\b(univ|inc|institute|lab|dept|department|school|college|google|research|corp)", first, re.I):
                continue
            if NAME_RE.match(first) and not AFFIL_RE.search(first):
                names.append(first)
        authors = ", ".join(dict.fromkeys(names))[:300]
    return title, authors


def _figures(doc: pymupdf.Document, public: Path, limit: int = 12) -> list[Figure]:
    out: list[Figure] = []
    seen: set[str] = set()
    for pno, page in enumerate(doc, 1):
        W, H = page.rect.width, page.rect.height
        blocks = [b for b in page.get_text("dict")["blocks"] if b.get("type") == 0]
        graphics = [pymupdf.Rect(i["bbox"]) for i in page.get_image_info() if pymupdf.Rect(i["bbox"]).get_area() > 900]
        try:
            graphics += [d["rect"] for d in page.get_drawings() if d["rect"].get_area() > 30 or d["rect"].width > 20 or d["rect"].height > 20]
        except Exception:  # noqa: BLE001 - some PDFs have broken drawing lists
            pass
        for b in blocks:
            text = _block_text(b)
            m = CAPTION_RE.match(text)
            if not m:
                continue
            kind = "table" if m.group(1).lower().startswith("tab") else "figure"
            key = f"{kind}{m.group(2)}"
            if key in seen:
                continue
            cap = pymupdf.Rect(b["bbox"])
            full = cap.width > W * 0.55 or (cap.x0 < W * 0.4 and cap.x1 > W * 0.6)
            x0, x1 = (W * 0.06, W * 0.94) if full else ((W * 0.05, W * 0.52) if cap.x0 < W / 2 else (W * 0.48, W * 0.95))

            def is_body(o: dict) -> bool:
                r = pymupdf.Rect(o["bbox"])
                t = _block_text(o)
                return (len(t) > 180 or len(o["lines"]) >= 4) and r.x1 > x0 and r.x0 < x1 and not CAPTION_RE.match(t)

            def region(above: bool) -> pymupdf.Rect | None:
                if above:
                    lim = max([pymupdf.Rect(o["bbox"]).y1 for o in blocks if is_body(o) and o["bbox"][3] <= cap.y0 + 1] + [H * 0.05])
                    r = pymupdf.Rect(x0, lim, x1, cap.y0)
                else:
                    lim = min([pymupdf.Rect(o["bbox"]).y0 for o in blocks if is_body(o) and o["bbox"][1] >= cap.y1 - 1] + [H * 0.95])
                    r = pymupdf.Rect(x0, cap.y1, x1, lim)
                inside = [g for g in graphics if r.contains(_center(g))]
                inside += [pymupdf.Rect(o["bbox"]) for o in blocks if o is not b and r.contains(_center(pymupdf.Rect(o["bbox"]))) and not is_body(o)]
                if not inside:
                    return None
                u = pymupdf.Rect(inside[0])
                for g in inside[1:]:
                    u |= g
                u = (u + (-6, -6, 6, 6)) & page.rect
                return u if u.height > 50 and u.width > 80 else None

            r = region(above=kind == "figure") or region(above=kind != "figure")
            if r is None:
                continue
            seen.add(key)
            fid = f"F{len(out) + 1}"
            rel = f"figures/{fid}.png"
            aspect = _save_crop(page, r, public / rel, dpi=170)
            caption = text[:400]
            label = f"{'Table' if kind == 'table' else 'Figure'} {m.group(2)} · page {pno}"
            out.append(Figure(fid, pno, kind, m.group(2), caption, rel, aspect, label))
            if len(out) >= limit:
                return out
    return out


def _equations(doc: pymupdf.Document, public: Path, limit: int = 14) -> list[Equation]:
    """Numbered display equations. The number "(n)" sits at the right of the equation, either in the same text line as
    the math or as its own line; the equation is every short line in the same horizontal band left of the number
    (fractions put numerator and denominator just above and below that band)."""
    cands: list[tuple[int, pymupdf.Rect, str, str]] = []
    for pno, page in enumerate(doc, 1):
        W = page.rect.width
        lines = []
        for b in page.get_text("dict")["blocks"]:
            if b.get("type") == 0:
                for ln in b["lines"]:
                    txt = _norm("".join(s["text"] for s in ln["spans"]))
                    if txt:
                        lines.append((pymupdf.Rect(ln["bbox"]), txt, ln["spans"]))
        for rect, text, spans in lines:
            num = EQ_NUM_RE.search(text)
            if not num or len(text) > 160:
                continue
            standalone = text.strip() == num.group(0).strip()
            if not standalone and (_math_ratio(spans) < 0.25 or len(text) > 120):
                continue  # a sentence that ends with a reference like "(1)"
            if rect.x1 < W * 0.45:
                continue  # equation numbers sit at the right edge of a column
            num_x = rect.x1 - 30 if not standalone else rect.x0
            band0, band1 = rect.y0 - 16, rect.y1 + 16
            parts = [] if standalone else [(rect, text)]
            for r2, t2, _ in lines:
                if r2 == rect or len(t2) > 110 or r2.x1 > num_x + 2:
                    continue
                cy = (r2.y0 + r2.y1) / 2
                if band0 <= cy <= band1 and not EQ_NUM_RE.search(t2):
                    parts.append((r2, t2))
            if not parts:
                continue
            u = pymupdf.Rect(rect)
            for r2, _ in parts:
                u |= r2
            if u.height > 140:
                continue
            body = " ".join(t2 for _, t2 in sorted(parts, key=lambda x: (round(x[0].y0 / 4), x[0].x0)))
            if standalone:
                body = f"{body} {num.group(0)}"
            cands.append((pno, (u + (-8, -6, 8, 6)) & page.rect, num.group(1), body))
    by_num: dict[str, tuple] = {}
    for c in cands:
        by_num.setdefault(c[2], c)  # first occurrence of each number
    chosen = sorted(by_num.values(), key=lambda c: (c[0], c[1].y0))[:limit]
    out: list[Equation] = []
    for pno, rect, num, text in chosen:
        eid = f"E{len(out) + 1}"
        rel = f"equations/{eid}.png"
        aspect = _save_crop(doc[pno - 1], rect, public / rel, dpi=260)
        out.append(Equation(eid, pno, num, text[:300], rel, aspect, f"Eq. ({num}) · page {pno}"))
    return out


# ---------- arXiv LaTeX source (exact equations) ----------

ENV_RE = re.compile(r"\\begin\{(equation|align|gather|multline|eqnarray)(\*?)\}(.*?)\\end\{\1\2\}", re.S)
MACRO_RE = re.compile(r"\\(?:re)?newcommand\*?\s*\{?\\([A-Za-z]+)\}?\s*(?:\[(\d)\])?\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}")
DEF_RE = re.compile(r"\\def\\([A-Za-z]+)\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}")


def latex_equations(src: str) -> tuple[list[str], dict[str, str]]:
    """Numbered display equations in source order (one entry per numbered environment) and simple user macros."""
    src = re.sub(r"(?<!\\)%.*", "", src)
    eqs: list[str] = []
    for m in ENV_RE.finditer(src):
        if m.group(2) == "*":
            continue
        body = re.sub(r"\\label\{[^}]*\}|\\nonumber|\\notag", "", m.group(3)).strip()
        if m.group(1) in ("align", "eqnarray"):
            body = "\\begin{aligned}" + body.replace("&=&", "&=") + "\\end{aligned}"
        elif m.group(1) == "gather":
            body = "\\begin{gathered}" + body + "\\end{gathered}"
        if 3 < len(body) < 600:
            eqs.append(body)
    macros: dict[str, str] = {}
    for m in MACRO_RE.finditer(src):
        macros["\\" + m.group(1)] = m.group(3)
    for m in DEF_RE.finditer(src):
        macros.setdefault("\\" + m.group(1), m.group(2))
    return eqs, macros


def latex_matches(latex: str, pdf_text: str) -> bool:
    """True when the LaTeX and the PDF's text of the equation contain mostly the same letters and digits
    (commands like \frac or \alpha are ignored), so a numbering mismatch never shows the wrong equation."""
    a = Counter(re.sub(r"[^A-Za-z0-9]", "", re.sub(r"\[A-Za-z]+", " ", latex)))
    b = Counter(re.sub(r"[^A-Za-z0-9]", "", EQ_NUM_RE.sub("", pdf_text)))
    if sum(a.values()) < 2 or sum(b.values()) < 2:
        return False
    return sum((a & b).values()) / max(sum(a.values()), sum(b.values())) >= 0.6


def find_arxiv_id(pages: list[str]) -> str:
    m = ARXIV_STAMP_RE.search(" ".join(pages[:1]))
    return m.group(1) if m else ""


def extract(pdf_path: Path, public: Path, latex_source: str = "") -> PaperContent:
    doc = pymupdf.open(str(pdf_path))
    try:
        pages = [p.get_text("text") for p in doc]
        title, authors = _title_and_authors(doc)
        figures = _figures(doc, public)
        equations = _equations(doc, public)
    finally:
        doc.close()
    content = PaperContent(title=title, authors=authors, arxiv_id=find_arxiv_id(pages), pages=pages, figures=figures, equations=equations)
    if latex_source:
        attach_latex(content, latex_source)
    log.info("extracted %d pages, %d figures/tables, %d equations from %s", len(pages), len(figures), len(equations), pdf_path.name)
    return content


def attach_latex(content: PaperContent, latex_source: str) -> None:
    """Numbered environments are numbered 1..N in source order; attach the exact LaTeX to the matching PDF equation
    only when its symbols agree with the PDF text."""
    content.latex_equations, content.macros = latex_equations(latex_source)
    for eq in content.equations:
        n = int(eq.number) if eq.number.isdigit() else 0
        if 0 < n <= len(content.latex_equations) and latex_matches(content.latex_equations[n - 1], eq.text):
            eq.latex = content.latex_equations[n - 1]
    log.info("arXiv source: %d numbered equations, %d matched to the PDF", len(content.latex_equations), sum(1 for e in content.equations if e.latex))
