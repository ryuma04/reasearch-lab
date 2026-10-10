"""Research-paper preparation materials for one version (run).

Everything is assembled from what was recorded for this exact run: the research brief and sources, the plans, the
settings, the measured metrics with their proof, the test and scorecard results, the events, and the code files
(read with Python's ast module). No language model writes any sentence here, so nothing is paraphrased into a
claim, no citation can be invented, and a metric that was not measured is reported as not measured. Sections that
cannot be built from the available artifacts say what is missing, and the package is then marked partial.
"""
from __future__ import annotations

import ast
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from . import db
from .project import load_settings, pdir

log = logging.getLogger("lab.paper")
INTEGRITY = ("> These materials are an evidence pack, not a paper. Every statement below comes from this version's recorded artifacts. "
             "You are responsible for verifying it, for the argument, the wording and the claims of novelty, and for following your "
             "institution's academic-integrity rules.\n")


def _read_json(p: Path):
    try:
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None
    except ValueError:
        return None


def collect(run_id: int) -> dict:
    run = db.q1("SELECT * FROM runs WHERE id=%s", (run_id,))
    root = pdir(run_id)
    events = db.q("SELECT time, agent, type, message, links FROM run_events WHERE run_id=%s ORDER BY id", (run_id,))
    review = _read_json(root / "research" / "plan_review.json") or {}
    return {"run": run, "root": root, "ws": db.q1("SELECT * FROM workspaces WHERE id=%s", (run["workspace_id"],)),
            "brief": _read_json(root / "research" / "brief.json") or {}, "review": review, "events": events,
            "settings": load_settings(run_id),
            "metrics": db.q("SELECT DISTINCT ON (name) name, value, code_version, log_file, log_line, exec_id FROM metrics WHERE run_id=%s ORDER BY name, id DESC", (run_id,)),
            "score": db.q("""SELECT c.description, c.value AS paper, c.unit, c.page, se.status, m.value AS ours FROM scorecard_entries se
                             JOIN claims c ON c.id=se.claim_id LEFT JOIN metrics m ON m.id=se.metric_id WHERE se.run_id=%s ORDER BY c.id""", (run_id,)),
            "gaps": db.q("SELECT g.explanation, c.description FROM gap_analyses g JOIN claims c ON c.id=g.claim_id WHERE g.run_id=%s", (run_id,)),
            "explorer": (db.q1("SELECT data FROM explorer_analyses WHERE run_id=%s AND status='done'", (run_id,)) or {}).get("data") or {},
            "change": db.q1("SELECT * FROM change_requests WHERE new_run_id=%s", (run_id,))}


def code_facts(root: Path) -> list[dict]:
    """Modules, classes and functions that exist in the version's own src/ files (parsed, not guessed)."""
    out = []
    for p in sorted((root / "src").glob("**/*.py")) if (root / "src").exists() else []:
        if p.is_symlink() or "__pycache__" in p.parts:
            continue
        try:
            tree = ast.parse(p.read_text(encoding="utf-8", errors="replace"))
        except SyntaxError:
            out.append({"file": p.relative_to(root).as_posix(), "error": "does not parse", "items": []})
            continue
        items = [{"kind": "class" if isinstance(n, ast.ClassDef) else "function", "name": n.name, "doc": (ast.get_docstring(n) or "").split("\n")[0],
                  "line": n.lineno} for n in tree.body if isinstance(n, (ast.ClassDef, ast.FunctionDef))]
        out.append({"file": p.relative_to(root).as_posix(), "doc": (ast.get_docstring(tree) or "").split("\n")[0], "items": items})
    return out


def _fmt(v) -> str:
    return f"{v:g}" if isinstance(v, (int, float)) else str(v)


def _plan(d: dict) -> list[dict]:
    rv = d["review"]
    block = rv.get(rv.get("ready") or "initial") or {}
    return ((block.get("plan") or {}).get("tasks")) or []


def _paper(d: dict) -> dict:
    return (d["brief"].get("papers") or [{}])[0]


def overview(d: dict) -> tuple[str, list[str]]:
    miss, p, md = [], _paper(d), [INTEGRITY, "# Research overview", ""]
    if not p:
        return "\n".join(md + ["No research brief was recorded for this version, so there is nothing to summarise."]), ["research brief"]
    md += [f"**Version:** run #{d['run']['id']} ({d['run']['status']}). " + (f"Created from run #{d['change']['source_run_id']} by the change request: \"{d['change']['request_text']}\"" if d["change"] else "Original version."), "",
           "## Research objective", f"Reproduce and check the main reported results of **{p.get('title', '')}**" + (f" (arXiv:{p['arxiv_id']})" if p.get("arxiv_id") else "") + f", within the {d['run']['compute_budget']} compute budget.",
           f"Researcher note: {d['ws']['note']}" if d["ws"].get("note") else "", "",
           "## Problem statement and motivation", p.get("summary") or "_The paper summary was not recorded._", "",
           "_Source: the Paper Reader's summary of the paper itself; the project did not record a separate problem statement._", ""]
    if not p.get("summary"):
        miss.append("paper summary")
    md += ["## Research questions (derived from the paper's claims)"] + [f"- Can we reproduce: {c['description']} ({_fmt(c['value'])} {c.get('unit', '')}, page {c.get('page') or 'n/a'})?" for c in p.get("claims", [])] + [""]
    related = (d["brief"].get("sources") or {}).get("related_papers") or []
    md += ["## Related work investigated"] + ([f"- {r['title']} ({r.get('year') or 'year n/a'})" + (f", arXiv:{r['arxiv']}" if r.get("arxiv") else "") for r in related] or ["_No related papers were recorded._"]) + [""]
    if not related:
        miss.append("related work")
    md += ["## Research findings (claims extracted from the paper)", "| Claim | Paper value | Page |", "|---|---|---|"] + [f"| {c['description']} | {_fmt(c['value'])} {c.get('unit', '')} | {c.get('page') or 'n/a'} |" for c in p.get("claims", [])] + [""]
    md += ["## Identified research gaps", "_Evidence-backed gaps cite sentences from papers; hypotheses are labelled and are not findings._"]
    gaps = d["explorer"].get("gaps") or []
    md += [f"- **[{g.get('kind', '').replace('_', ' ')}]** {g['title']}: {g.get('explanation', '')}" for g in gaps] or ["_The Research Gap Explorer was not run for this version._"]
    if not gaps:
        miss.append("research gaps (Gap Explorer not run)")
    md += ["", "## Proposed approach and implementation overview"] + [f"- **{t.get('id')} {t.get('title')}**: {t.get('completion', '')}" for t in _plan(d)]
    if not _plan(d):
        md.append("_No implementation plan was recorded._")
        miss.append("implementation plan")
    md += ["", "## Evaluation methodology",
           "Claims are compared with the paper's numbers using the tolerance stored with each claim; Match, Close or Different. Correctness tests check the code itself."]
    md += ["", "## Actual results", "See *Experimental setup and results*.", "", "## Limitations (recorded)"]
    lims = [f"- Setting `{s['name']}` = {s['value']} ({s['source'].replace('_', ' ')}: {s['reason'] or 'no reason recorded'})" for s in d["settings"] if s["source"] in ("assumption", "compute_change")]
    md += lims or ["_No assumptions or compute-driven changes were recorded._"]
    md += ["", "## Future work (proposals, not implemented)"] + ([f"- {r}" for r in (d["review"].get(d["review"].get("ready") or "initial") or {}).get("plan", {}).get("risks", [])] or ["_None recorded._"])
    return "\n".join(x for x in md if x is not None), miss


def architecture(d: dict) -> tuple[str, list[str]]:
    facts = code_facts(d["root"])
    agents = sorted({e["agent"] for e in d["events"] if e["agent"] and e["agent"] != "system"})
    lab = Path(__file__).resolve().parent
    modules = sorted(p.stem for p in lab.glob("*.py") if p.stem not in ("__init__",))
    md = [INTEGRITY, "# System architecture", "", "## A. The implementation produced in this version", ""]
    md += [f"- `{f['file']}`" + (f": {f['doc']}" if f.get("doc") else "") + ("".join(f"\n  - {i['kind']} `{i['name']}`" + (f": {i['doc']}" if i["doc"] else "") for i in f["items"])) for f in facts] or ["_No source files were found in src/ for this version._"]
    req = d["root"] / "requirements.txt"
    md += ["", "**Dependencies (requirements.txt):** " + (", ".join(l.strip() for l in req.read_text(encoding="utf-8").splitlines() if l.strip() and not l.startswith("#")) if req.exists() else "_not recorded_"), "",
           "## B. The Research Lab that produced and verified it", "",
           "```mermaid", "flowchart LR", "  U[Researcher] --> FE[Next.js frontend]", "  FE -->|REST + SSE| API[Go API]", "  API --> DB[(PostgreSQL)]",
           "  API --> R[(Redis jobs and events)]", "  R --> W[Python worker, LangGraph pipeline]", "  W --> API", "  W -->|run code| SB[Docker sandbox]", "  W --> LLM[Model providers]", "```", "",
           "Agents that acted in this version (from its recorded events): " + (", ".join(f"`{a}`" for a in agents) or "_none recorded_") + ".", "",
           "Agent modules present in this installation: " + ", ".join(f"`{m}`" for m in modules) + "."]
    return "\n".join(md), ([] if facts else ["source files"])


def workflow(d: dict) -> tuple[str, list[str]]:
    stages: dict[str, dict] = {}
    for e in d["events"]:
        if e["type"] == "stage":
            stages.setdefault((e["links"] or {}).get("stage") or e["message"], {"start": e["time"], "message": e["message"]})
    md = [INTEGRITY, "# Complete workflow", "", "Stages this version actually went through, in order (from its recorded events):", "",
          "| Stage | Started | Recorded outcome |", "|---|---|---|"]
    for name, s in stages.items():
        evs = [e for e in d["events"] if e["type"] in ("brief_ready", "plan_ready", "files_written", "results_ready", "tests_finished", "test_verdict", "run_completed", "run_failed", "version_created") and (e["links"] or {}).get("stage", name) == name]
        md.append(f"| {name.replace('_', ' ')} | {s['start']:%Y-%m-%d %H:%M} | {'; '.join(e['message'][:90] for e in evs[:2]) or '-'} |")
    md += ["", "## What each stage takes in and hands on", "",
           "| Stage | Input | Output |", "|---|---|---|",
           "| Research | uploaded paper(s), note | claims with pages, research brief, sources, better-resource review |",
           "| Planning | brief, settings, resource decisions | initial and optimized implementation plans (both kept), validation |",
           "| Plan approval | plans | your approve / edit / reject decision |",
           "| Coding | approved plan, settings | project files in `src/`, `configs/`, `requirements.txt` |",
           "| Execution | project files | `results/metrics.json`, logs |", "| Testing | metrics, code | junit results, test verdict, claim scorecard |",
           "| Gap analysis | differing claims | small experiments and an explanation |", "",
           "Failure handling observed in this version: " + (", ".join(sorted({e["type"] for e in d["events"] if e["type"] in ("fix_applied", "fix_failed", "debug_ineffective", "run_failed", "plan_blocked")})) or "none occurred") + "."]
    return "\n".join(md), ([] if stages else ["stage events"])


def dataflow(d: dict) -> tuple[str, list[str]]:
    p = _paper(d)
    ids = f"workspace {d['run']['workspace_id']}, run {d['run']['id']}" + (f", parent run {d['run']['parent_run_id']}" if d["run"].get("parent_run_id") else "")
    md = [INTEGRITY, "# Data flow", "", f"Identifiers linking this version's records: {ids}; {len(p.get('claims', []))} claim(s); {len(d['metrics'])} recorded metric(s).", "",
          "```mermaid", "sequenceDiagram", "  participant U as Researcher", "  participant A as Go API", "  participant W as Python worker", "  participant S as Docker sandbox", "  participant D as PostgreSQL",
          "  U->>A: paper, note, change request", "  A->>D: workspace, upload, run", "  A->>W: job over Redis", "  W->>D: claims, settings, events", "  W->>S: run code", "  S-->>A: metrics.json with proof (run, commit, log line)",
          "  A->>D: metrics", "  W->>D: scorecard, tests", "  A-->>U: live events (SSE), results", "```", "",
          "## Where data comes from, how it is checked, where it goes",
          "- **Input:** the paper PDF or arXiv link is validated by the API (arXiv ids only, size limits) and stored under the workspace.",
          "- **Claims:** a number is kept only if it appears in the paper text; each keeps page and position.",
          "- **Results:** numbers are accepted only from `results/metrics.json` written by the sandboxed code; each is stored with run id, code version, log file hash and line.",
          "- **Events:** every agent step is written to `run_events` and streamed to the browser; refreshing replays them.",
          "- **Errors and retries:** failures become events; repairs are bounded and re-verified by re-running the tests."]
    return "\n".join(md), []


def algorithms(d: dict) -> tuple[str, list[str]]:
    facts = code_facts(d["root"])
    p = _paper(d)
    md = [INTEGRITY, "# Algorithms and models", "", "## Implemented in this version's code (parsed from `src/`)"]
    md += [f"- `{f['file']}` `{i['name']}` ({i['kind']}, line {i['line']})" + (f": {i['doc']}" if i["doc"] else "") for f in facts for i in f["items"]] or ["_No functions or classes were found in `src/`._"]
    md += ["", "## Method as extracted from the paper", ""] + ([f"{n}. {s}" for n, s in enumerate(p.get("method") or [], 1)] or ["_No method steps were recorded._"])
    md += ["", "## Configuration (settings and where each came from)", "| Setting | Value | Source |", "|---|---|---|"] + [f"| {s['name']} | {s['value']} | {s['source'].replace('_', ' ')} |" for s in d["settings"]]
    md += ["", "## LLM-based reasoning used by the lab (not part of the research implementation)"] + [f"- `{a}`" for a in sorted({e['agent'] for e in d['events'] if e['agent'].split('.')[0] in ('research', 'planning', 'change', 'coding', 'testing', 'gap_detective')})]
    md += ["", "## Deterministic orchestration", "- LangGraph state machine with checkpoints; test verdicts, claim scoring and proof checks are plain code, not model output.",
           "", "## Not implemented", "- No meta-controller, reward loop or agent evolution (the project documents a fixed pipeline by design). No custom or novel model is claimed."]
    return "\n".join(md), ([] if facts else ["source files"])


def results(d: dict) -> tuple[str, list[str]]:
    miss = []
    tests = [e for e in d["events"] if e["type"] == "tests_finished"]
    verdict = [e for e in d["events"] if e["type"] == "test_verdict"]
    md = [INTEGRITY, "# Experimental setup and results", "", f"Version: run #{d['run']['id']}, status **{d['run']['status']}**" + (f" (error: {d['run']['error']})" if d["run"].get("error") else "") + f", budget {d['run']['compute_budget']}.", "",
          "## Measured metrics (each is proven by a run, code version and log line)", "| Metric | Value | Code version | Log |", "|---|---|---|---|"]
    md += [f"| {m['name']} | {_fmt(m['value'])} | {m['code_version'] or 'n/a'} | {m['log_file']}:{m['log_line'] or '?'} |" for m in d["metrics"]]
    if not d["metrics"]:
        md.append("| _no metric was recorded_ | | | |")
        miss.append("measured metrics")
    md += ["", "## Claim scorecard (paper vs ours)", "| Claim | Paper | Ours | Status |", "|---|---|---|---|"] + [f"| {s['description']} | {_fmt(s['paper'])} | {_fmt(s['ours']) if s['ours'] is not None else 'not measured'} | {s['status']} |" for s in d["score"]]
    if not d["score"]:
        miss.append("claim scorecard")
    md += ["", "## Tests"]
    if tests:
        t = (tests[-1]["links"] or {}).get("summary") or {}
        md.append(f"Last test run: {t.get('passed', '?')} passed, {t.get('failed', '?')} failed, {t.get('skipped', '?')} skipped. These are code-test counts, not research-performance measurements.")
    else:
        md.append("_No test run was recorded._")
        miss.append("test results")
    if verdict:
        md.append(f"Verdict: **{(verdict[-1]['links'] or {}).get('verdict', 'unknown')}**.")
    md += ["", "## Gap analysis (experiments explaining differences)"] + ([f"- {g['description']}: {g['explanation']}" for g in d["gaps"]] or ["_Not run or not needed._"])
    durs = [e["message"] for e in d["events"] if e["type"] == "sandbox_finished"]
    md += ["", "## Execution evidence", *(f"- {m}" for m in durs[:10])] if durs else ["", "_No execution timings were recorded._"]
    md += ["", "## Not measured", "- Any metric not listed above was not measured in this version. Hardware details and variance across seeds were not recorded unless a gap experiment says otherwise."]
    return "\n".join(md), miss


def references(d: dict) -> tuple[str, list[str]]:
    p, src = _paper(d), d["brief"].get("sources") or {}
    ts = datetime.fromtimestamp((d["root"] / "research" / "brief.json").stat().st_mtime, timezone.utc).date().isoformat() if (d["root"] / "research" / "brief.json").exists() else "not recorded"
    md = [INTEGRITY, "# References and evidence", "", f"Research recorded on {ts}. Entries are exactly what the agents stored; nothing was added.", "", "## The paper studied",
          f"- {p.get('title', 'n/a')}" + (f", https://arxiv.org/abs/{p['arxiv_id'].split('v')[0]}" if p.get("arxiv_id") else "") + " (used for: claims, method, settings)", "", "## Related papers (found as citing the paper)"]
    md += [f"- {r['title']} ({r.get('year') or 'n/a'})" + (f", https://arxiv.org/abs/{r['arxiv']}" if r.get("arxiv") else "") + f" (citations recorded: {r.get('citations', 'n/a')})" for r in src.get("related_papers", [])] or ["_None recorded._"]
    md += ["", "## Datasets and repositories"] + [f"- {x.get('name') or x.get('url')}: {x.get('url', '')} (licence {x.get('licence', 'n/a')}; {'provided by you' if x.get('user_provided') else 'found by the agents'})" for x in src.get("datasets", []) + src.get("repositories", [])] or ["_None recorded._"]
    recs = (src.get("resources") or {}).get("recommendations", [])
    md += ["", "## Recommended alternatives reviewed"] + [f"- [{r['category'].replace('_', ' ')}] {r['name']}: {r['url']}" for r in recs] or ["_None._"]
    cr = (src.get("change_research") or {}).get("results", [])
    if cr:
        md += ["", "## Sources found for the change request"] + [f"- {x['name']}: {x['url']} (topic: {x['topic']})" for x in cr]
    for e in (d["explorer"].get("papers") or [])[:20]:
        md += [f"- {e.get('title')} ({e.get('year') or 'n/a'}) {e.get('url') or ''}"] if e.get("url") else []
    return "\n".join(md), ([] if p else ["sources"])


def outline(d: dict) -> tuple[str, list[str]]:
    sec = [("Abstract", "Write last. Use the objective, the approach and the measured results (Results page)."),
           ("Introduction", "Problem statement and motivation (Research overview), the claims you reproduce (Claims table)."),
           ("Related work", "References and evidence; read each source yourself before citing it."),
           ("Research gap", "Gap Explorer output if it was run; treat hypotheses as hypotheses."),
           ("Methodology", "Algorithms and models; settings table with the source of each value."),
           ("System architecture", "Architecture and Data flow documents."),
           ("Implementation", "Code facts in Architecture section A; the changed files between versions (Compare view)."),
           ("Experimental setup", "Budget, settings, environment from the Results document; what was not measured."),
           ("Results and discussion", "Metrics with proof and the claim scorecard; explain differences using the gap analysis."),
           ("Limitations", "Assumptions and compute-driven changes; failed or skipped tests."),
           ("Conclusion and future work", "Only what the evidence supports; label proposals as proposals."),
           ("References", "References and evidence; add full bibliographic details yourself.")]
    return "\n".join([INTEGRITY, "# Writing outline", ""] + [f"## {i}. {t}\n{h}\n" for i, (t, h) in enumerate(sec, 1)]), []


BUILDERS = [("overview", overview), ("architecture", architecture), ("workflow", workflow), ("dataflow", dataflow),
            ("algorithms", algorithms), ("results", results), ("references", references), ("outline", outline)]


def generate(run_id: int) -> dict:
    db.ex("UPDATE paper_materials SET status='generating', error='', updated_at=now() WHERE run_id=%s", (run_id,))
    try:
        d = collect(run_id)
        out = d["root"] / "research" / "paper"
        out.mkdir(parents=True, exist_ok=True)
        missing, completeness = {}, {}
        for key, fn in BUILDERS:
            text, miss = fn(d)
            (out / f"{key}.md").write_text(text, encoding="utf-8")
            completeness[key] = "partial" if miss else "complete"
            if miss:
                missing[key] = miss
        manifest = {"run_id": run_id, "workspace_id": d["run"]["workspace_id"], "parent_run_id": d["run"].get("parent_run_id"),
                    "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "completeness": completeness, "missing": missing,
                    "method": "assembled from recorded artifacts; no language model wrote any text"}
        status = "partial" if missing else "ready"
        db.ex("UPDATE paper_materials SET status=%s, manifest=%s, updated_at=now() WHERE run_id=%s", (status, db.J(manifest), run_id))
        return manifest
    except Exception as e:  # noqa: BLE001
        log.exception("paper materials failed")
        db.ex("UPDATE paper_materials SET status='failed', error=%s, updated_at=now() WHERE run_id=%s", (str(e)[:500], run_id))
        raise
