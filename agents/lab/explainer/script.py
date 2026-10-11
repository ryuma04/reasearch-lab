"""Scene script for the explainer video, written by the LLM and then checked against the paper.

Rules enforced in code (not only asked for in the prompt):
  - every number shown or spoken must appear in the paper text (otherwise the sentence or point is removed),
  - quotes shown on screen must be verbatim sentences of the paper (otherwise they are dropped),
  - figures and equations can only be chosen by id from what was extracted from the PDF,
  - narration is spoken English: no LaTeX, no markup,
  - total narration of 450-750 words (3-5 minutes); the model gets up to two repair rounds.
Without any AI key a fallback script is assembled from the paper's own sentences, so nothing is ever invented.
"""
from __future__ import annotations

import json
import logging
import re
import unicodedata

from .. import llm
from .extract import PaperContent

log = logging.getLogger("lab.explainer.script")

KINDS = ("intro", "problem", "method", "equation", "result", "conclusion")
POSES = ("explaining", "pointing", "thinking", "excited", "concluding")
EXPRESSIONS = ("happy", "curious", "focused", "surprised", "proud")
KICKERS = {"intro": "Paper explainer", "problem": "The problem", "method": "The method", "equation": "Key equation",
           "result": "The results", "conclusion": "Takeaways"}
MIN_WORDS, MAX_WORDS = 450, 750
NUM_RE = re.compile(r"(?<![\w.])[-+]?\d+(?:[.,]\d+)*(?:\s?%)?")
LATEX_RE = re.compile(r"[\\$^_{}]|\b(?:frac|mathbf|mathcal|sum_|alpha|beta)\b")
SENT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"“(])")

SYSTEM = """You write the script of a 3 to 5 minute explainer video about ONE research paper.
A friendly animated mascot narrates it; the paper's content is shown on screen next to the mascot.

HARD RULES
1. Use ONLY facts, claims and numbers that are written in the paper text below. Never invent or estimate anything,
   never add outside knowledge, never round numbers. Copy every number exactly as the paper writes it, in digits
   (for example 92.3% or 0.001), never spelled out in words.
2. "narration" is plain spoken English for a voice actor: no LaTeX, no symbols like ^ _ \\ $ { }, no markdown,
   no citations like [12]. Say math in words ("x squared", "the sum over all tokens", "W times x").
3. Total narration of all scenes together: 520 to 680 words. Short, clear sentences. Friendly, not hype.
4. On-screen text is short: heading up to 7 words; each point up to 12 words.
5. "quotes" must be copied character for character from the paper (one sentence each, at most 30 words), with its page.
6. You may only show figures and equations from the provided lists, by their id. Show at most one of them per scene.

STRUCTURE (6 to 9 scenes, in this order)
- intro: what the paper is and why it matters (no points; the title card is shown). pose "excited".
- problem: the problem the paper addresses and why existing approaches fall short. pose "thinking" or "explaining".
- method: 1 to 3 scenes on how it works; use a figure when one illustrates the method.
- equation: the single most important equation, explained term by term in words. pose "pointing".
- result: 1 or 2 scenes with the main reported results (exact numbers) and a table or figure if useful.
- conclusion: takeaways and stated limitations. pose "concluding", expression "proud".

For every point, quote and the figure/equation give a "cue": 2 to 5 consecutive words copied from that scene's
narration at the moment the item should appear on screen.

Return JSON:
{"title": str, "authors": str,
 "scenes": [{"kind": one of intro|problem|method|equation|result|conclusion,
             "heading": str, "narration": str,
             "pose": one of explaining|pointing|thinking|excited|concluding,
             "expression": one of happy|curious|focused|surprised|proud,
             "figure_id": str or null, "equation_id": str or null, "visual_cue": str or null,
             "points": [{"text": str, "cue": str}],
             "quotes": [{"text": str, "page": int, "cue": str}]}]}"""


# ---------- normalisation used by every check ----------

def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("‐", "-").replace("‑", "-").replace("−", "-").replace("–", "-").replace("—", "-")
    s = re.sub(r"[‘’‚′]", "'", s)
    s = re.sub(r"[“”„″]", '"', s)
    s = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", s)  # hyphenation at line ends
    return re.sub(r"\s+", " ", s).strip().lower()


class Checker:
    def __init__(self, paper: PaperContent):
        self.pages = [norm(p) for p in paper.pages]
        self.full = " ".join(self.pages)
        self.full_nospace = re.sub(r"[^a-z0-9%.]", "", self.full)
        allowed = set()
        for f in paper.figures:
            allowed.add(f.number)
        for e in paper.equations:
            allowed.add(e.number)
        self.allowed = allowed

    def number_ok(self, tok: str) -> bool:
        t = tok.strip().replace(" ", "").lower()
        bare = t.rstrip("%").lstrip("+")
        if bare in self.allowed:
            return True
        variants = {t, bare, bare.replace(",", ""), t.replace(",", "")}
        for v in variants:
            if v and re.search(r"(?<![\d.])" + re.escape(v) + r"(?!\d)", self.full):
                return True
        # tolerate "92.3 %" vs "92.3%" and numbers split by PDF spacing
        return bool(bare) and bare.replace(",", "") in self.full_nospace and len(bare) >= 3

    def bad_numbers(self, text: str) -> list[str]:
        return [m.group(0).strip() for m in NUM_RE.finditer(text) if not self.number_ok(m.group(0))]

    def quote_page(self, quote: str) -> int | None:
        q = norm(quote).strip(" \"'")
        q = q.rstrip(".")
        if len(q) < 12:
            return None
        for i, p in enumerate(self.pages, 1):
            if q in p:
                return i
        return None


def word_count(scenes: list[dict]) -> int:
    return sum(len(s.get("narration", "").split()) for s in scenes)


def _clean_narration(text: str) -> str:
    text = re.sub(r"\[[\d,\s–-]+\]", "", text)          # citation markers
    text = re.sub(r"[*#`]+", "", text)                    # markdown
    return re.sub(r"\s+", " ", text).strip()


def problems(script: dict, paper: PaperContent, ck: Checker) -> list[str]:
    out = []
    scenes = script.get("scenes") or []
    if not 5 <= len(scenes) <= 10:
        out.append(f"use 6 to 9 scenes (you wrote {len(scenes)})")
    wc = word_count(scenes)
    if wc < MIN_WORDS:
        out.append(f"the narration has {wc} words in total; it must be between 520 and 680 words. Expand the method and result scenes using more facts from the paper.")
    elif wc > MAX_WORDS:
        out.append(f"the narration has {wc} words in total; it must be between 520 and 680 words. Shorten it.")
    fig_ids = {f.id for f in paper.figures}
    eq_ids = {e.id for e in paper.equations}
    for i, s in enumerate(scenes, 1):
        n = s.get("narration", "")
        if LATEX_RE.search(n):
            out.append(f"scene {i}: the narration contains LaTeX or symbols; say the math in plain words")
        for tok in ck.bad_numbers(n + " " + s.get("heading", "") + " " + " ".join(p.get("text", "") for p in s.get("points") or [])):
            out.append(f"scene {i}: the number '{tok}' does not appear in the paper; remove it or use the exact number from the paper")
        if s.get("figure_id") and s["figure_id"] not in fig_ids:
            out.append(f"scene {i}: figure_id {s['figure_id']} does not exist")
        if s.get("equation_id") and s["equation_id"] not in eq_ids:
            out.append(f"scene {i}: equation_id {s['equation_id']} does not exist")
        for q in s.get("quotes") or []:
            if ck.quote_page(q.get("text", "")) is None:
                out.append(f"scene {i}: the quote \"{q.get('text', '')[:80]}\" is not verbatim in the paper; copy it exactly or remove it")
    return out[:25]


def _paper_prompt(paper: PaperContent, budget: int = 90_000) -> str:
    figs = "\n".join(f"- {f.id}: {f.label}. Caption: {f.caption[:300]}" for f in paper.figures) or "- (none found)"
    eqs = "\n".join(f"- {e.id}: {e.label}. Text as extracted from the PDF: {e.text[:220]}" + (f"\n  LaTeX from the paper's source: {e.latex[:300]}" if e.latex else "")
                    for e in paper.equations) or "- (none found)"
    body = "".join(f"\n[page {i}]\n{p}" for i, p in enumerate(paper.pages, 1))
    refs = re.search(r"\n\s*(?:\d+\.?\s*)?(references|bibliography)\s*\n", body, re.I)
    if refs and refs.start() > len(body) * 0.5:  # the reference list adds nothing to the explanation
        body = body[: refs.start()]
    if len(body) > budget:  # keep the beginning (abstract, intro, method) and the end (results, conclusion)
        body = body[: int(budget * 0.65)] + "\n[...]\n" + body[-int(budget * 0.35):]
    return (f"TITLE (as extracted): {paper.title}\nAUTHORS (as extracted): {paper.authors}\n\n"
            f"FIGURES AND TABLES YOU MAY SHOW:\n{figs}\n\nEQUATIONS YOU MAY SHOW:\n{eqs}\n\nPAPER TEXT:\n{body}")


# (route, paper text budget in characters, max output tokens). Gemini reads the whole paper; Groq's free tier allows
# about 8000 tokens per minute including the answer, so it gets a condensed paper.
TIERS = (("explainer", 90_000, 8000), ("explainer_fallback", 15_000, 3500), ("explainer_arina", 28_000, 4000))


def _ask(paper: PaperContent, extra: str = "", tiers=TIERS) -> tuple[dict | None, dict]:
    # A script is a long answer that needs little reasoning: low thinking keeps Gemini 3 from spending the
    # output budget on hidden thoughts and cutting the JSON off.
    token = llm.gemini_thinking.set("low")
    effort = llm.gateway_reasoning.set("minimal")  # the Arina gateway's 4000-token answer must hold the whole JSON
    try:  # reset afterwards: worker threads are reused by other jobs
        for route, budget, out_tokens in tiers:
            user = _paper_prompt(paper, budget) + extra
            data, tokens = llm.invoke_json(route, SYSTEM, user, max_tokens=out_tokens)
            if isinstance(data, dict) and data.get("scenes"):
                return data, {"tokens": tokens, "route": route, "tier": (route, budget, out_tokens)}
            log.warning("script route '%s' gave no usable answer (%s)", route, llm.last_error())
        return None, {"tokens": 0, "route": "none", "tier": None}
    finally:
        llm.gemini_thinking.reset(token)
        llm.gateway_reasoning.reset(effort)


def _sanitize(script: dict, paper: PaperContent, ck: Checker, report: dict) -> dict:
    """Deterministic last line of defence: drop anything that still breaks a rule."""
    fig_ids = {f.id for f in paper.figures}
    eq_ids = {e.id for e in paper.equations}
    scenes = []
    for i, raw in enumerate(script.get("scenes") or [], 1):
        kind = raw.get("kind") if raw.get("kind") in KINDS else ("intro" if i == 1 else "method")
        narration = _clean_narration(str(raw.get("narration", "")))
        kept = []
        for sent in SENT_RE.split(narration):
            bad = ck.bad_numbers(sent)
            if bad:
                report["removed_sentences"].append({"scene": i, "sentence": sent, "unverified_numbers": bad})
                continue
            kept.append(sent)
        narration = " ".join(kept)
        narration = re.sub(r"[\\$^_{}]", " ", narration)
        narration = re.sub(r"\s+", " ", narration).strip()
        if not narration:
            continue
        points = []
        for p in (raw.get("points") or [])[:4]:
            text = _clean_narration(str(p.get("text", "")))[:120]
            if not text:
                continue
            if ck.bad_numbers(text):
                report["removed_points"].append({"scene": i, "text": text})
                continue
            points.append({"text": text, "cue": str(p.get("cue") or "")})
        quotes = []
        for q in (raw.get("quotes") or [])[:2]:
            text = re.sub(r"\s+", " ", str(q.get("text", ""))).strip().strip('"“”')
            page = ck.quote_page(text)
            if page is None:
                report["removed_quotes"].append({"scene": i, "text": text})
                continue
            report["verified_quotes"] += 1
            quotes.append({"text": text, "page": page, "cue": str(q.get("cue") or "")})
        heading = _clean_narration(str(raw.get("heading") or KICKERS[kind]))[:70]
        if ck.bad_numbers(heading):
            heading = KICKERS[kind]
        fig = raw.get("figure_id") if raw.get("figure_id") in fig_ids else None
        eq = raw.get("equation_id") if raw.get("equation_id") in eq_ids else None
        if fig and eq:
            fig = None
        scenes.append({
            "kind": kind, "kicker": KICKERS[kind], "heading": heading, "narration": narration,
            "pose": raw.get("pose") if raw.get("pose") in POSES else ("pointing" if eq or fig else "explaining"),
            "expression": raw.get("expression") if raw.get("expression") in EXPRESSIONS else "happy",
            "figure_id": fig, "equation_id": eq, "visual_cue": str(raw.get("visual_cue") or ""),
            "points": points, "quotes": quotes,
        })
    if scenes:
        scenes[0]["kind"], scenes[0]["kicker"] = "intro", KICKERS["intro"]
    title = paper.title or str(script.get("title") or "")
    authors = paper.authors
    llm_authors = _clean_narration(str(script.get("authors") or ""))
    names = [n.strip() for n in re.split(r",| and ", llm_authors) if n.strip()]
    if names and all(norm(n) in ck.pages[0] for n in names):  # only names printed on the first page
        authors = ", ".join(names)
    return {"title": title, "authors": authors, "scenes": scenes}


def fallback(paper: PaperContent) -> dict:
    """No AI available: a script made only of the paper's own sentences (abstract, introduction, conclusion)."""
    text = re.sub(r"\s+", " ", re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", "\n".join(paper.pages)))
    def section(start: str, stop: str) -> str:
        m = re.search(start + r"(.*?)" + stop, text, re.I | re.S)
        return m.group(1) if m else ""
    abstract = section(r"\babstract\b", r"\b(?:1\.?\s+introduction|introduction)\b") or text[:2500]
    concl = section(r"\b\d?\.?\s*conclusions?\b", r"\b(?:references|acknowledg)") or ""
    sents = [s.strip() for s in SENT_RE.split(abstract) if 30 < len(s.strip()) < 400]
    csents = [s.strip() for s in SENT_RE.split(concl) if 30 < len(s.strip()) < 400]
    third = max(1, len(sents) // 3)
    eq = paper.equations[0].id if paper.equations else None
    fig = paper.figures[0].id if paper.figures else None
    scenes = [
        {"kind": "intro", "heading": "", "narration": f"Today's paper is: {paper.title}.", "pose": "excited", "expression": "happy"},
        {"kind": "problem", "heading": "The problem", "narration": " ".join(sents[:third]), "pose": "thinking", "expression": "curious"},
        {"kind": "method", "heading": "The approach", "narration": " ".join(sents[third:2 * third]), "pose": "explaining", "expression": "focused", "figure_id": fig},
        {"kind": "equation", "heading": "A key equation", "narration": "Here is one of the paper's central equations, exactly as printed.", "pose": "pointing", "expression": "focused", "equation_id": eq} if eq else None,
        {"kind": "result", "heading": "What they found", "narration": " ".join(sents[2 * third:]), "pose": "explaining", "expression": "surprised"},
        {"kind": "conclusion", "heading": "Takeaways", "narration": " ".join(csents[:4]) or "That's the paper in a nutshell.", "pose": "concluding", "expression": "proud"},
    ]
    return {"title": paper.title, "authors": paper.authors, "scenes": [s for s in scenes if s and s["narration"]]}


def write(paper: PaperContent) -> tuple[dict, dict]:
    """Returns (script, report). The report records every check and everything that was removed."""
    ck = Checker(paper)
    report: dict = {"removed_sentences": [], "removed_points": [], "removed_quotes": [], "verified_quotes": 0,
                    "repair_rounds": 0, "issues_left": [], "source": "llm", "tokens": 0}
    script, meta = _ask(paper)
    report["tokens"] += meta["tokens"]
    report["route"] = meta["route"]
    if script is None:
        log.warning("no AI answer for the script; using the paper's own sentences")
        report["source"] = "fallback (no AI answer): sentences copied from the paper"
        script = fallback(paper)
    else:
        for _ in range(2):
            issues = problems(script, paper, ck)
            if not issues:
                break
            report["repair_rounds"] += 1
            fix = (f"\n\nYOUR PREVIOUS SCRIPT:\n{json.dumps(script, ensure_ascii=False)}\n\nFIX THESE PROBLEMS and return the whole corrected JSON:\n- "
                   + "\n- ".join(issues))
            fixed, m2 = _ask(paper, fix, tiers=(meta["tier"],))  # same provider that wrote it
            report["tokens"] += m2["tokens"]
            if fixed is None:
                break
            script = fixed
        report["issues_left"] = problems(script, paper, ck)
    final = _sanitize(script, paper, ck, report)
    report["word_count"] = word_count(final["scenes"])
    report["scene_count"] = len(final["scenes"])
    if not final["scenes"]:
        raise RuntimeError("the script had no usable scene after the fact checks")
    return final, report
