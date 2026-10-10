import datetime
import json

import fitz

from lab import report

BRIEF = {
    "papers": [{"paper_id": 1, "title": "Distilling the Knowledge — résumé ✓", "arxiv_id": "1503.02531v1", "summary": "A small net copies a big net.",
                "method": ["Train teacher", "Distil at T=20"], "missing_details": ["epochs"],
                "claims": [{"id": 1, "description": "Student | distilled", "value": 74.0, "unit": "errors", "page": 4,
                            "table_ref": "Table 1", "quote": "74 test errors"}]}],
    "sources": {"datasets": [{"name": "MNIST", "url": "https://pytorch.org/vision/mnist", "size": "12 MB"}],
                "repositories": [{"name": "a/b", "url": "https://github.com/a/b", "user_provided": True}],
                "related_papers": [{"title": "Born-Again Networks", "year": 2018, "citations": 900, "arxiv": "1805.04770"},
                                   {"title": "Paper without id", "year": 2020}],
                "recommendation": "Re-implement."},
}
DATA = {
    "run": {"id": 7, "status": "waiting_approval", "stage": "plan_approval", "compute_budget": "quick", "workspace": "Distillation"},
    "brief": BRIEF,
    "settings": [{"name": "train.epochs", "value": "8", "source": "compute_change", "source_ref": None, "reason": "fits budget", "paper_value": ""}],
    "plan": {"status": "pending", "payload": {"draft": {"changes": {"train.epochs": 12}, "note": "keep it short"}},
             "response": {}, "created_at": datetime.datetime(2026, 10, 10), "resolved_at": None},
}


def test_markdown_has_sections_links_and_escaped_tables():
    md = report.to_markdown(report.build_doc(DATA))
    assert "# Research & Planning report: Distillation" in md
    assert "[arXiv:1503.02531](https://arxiv.org/abs/1503.02531)" in md
    assert "[MNIST](https://pytorch.org/vision/mnist)" in md
    assert "[Born-Again Networks](https://arxiv.org/abs/1805.04770)" in md
    assert "Paper without id (2020)" in md and "](https://arxiv.org/abs/None" not in md, "no fabricated URL"
    assert "Student \\| distilled" in md
    assert "12 (unsaved draft edit)" in md and "keep it short" in md


def test_unavailable_brief_is_stated_not_invented():
    md = report.to_markdown(report.build_doc({**DATA, "brief": None, "plan": None}))
    assert "not available yet" in md and "has not been produced yet" in md


def test_unsafe_urls_are_not_linked():
    bad = {**DATA, "brief": {**BRIEF, "sources": {**BRIEF["sources"], "datasets": [
        {"name": "x", "url": "javascript:alert(1)"}, {"name": "y", "url": "https://user:pass@evil.example/x"}]}}}
    md = report.to_markdown(report.build_doc(bad))
    assert "javascript:" not in md and "pass@" not in md


def test_json_roundtrips():
    parsed = json.loads(report.to_json(DATA, report.build_doc(DATA)))
    assert parsed["run"]["id"] == 7 and parsed["brief"]["papers"][0]["claims"][0]["value"] == 74.0
    assert any(s["type"] == "table" for s in parsed["sections"])


def test_pdf_opens_has_text_and_live_links():
    pdf = report.to_pdf(report.build_doc(DATA))
    assert pdf.startswith(b"%PDF")
    doc = fitz.open(stream=pdf, filetype="pdf")
    text = "".join(p.get_text() for p in doc)
    assert "Research & Planning report" in text and "Born-Again Networks" in text and "MNIST" in text
    uris = {l.get("uri") for p in doc for l in p.get_links()}
    assert "https://arxiv.org/abs/1805.04770" in uris and "https://pytorch.org/vision/mnist" in uris
