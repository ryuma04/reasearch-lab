"""The main LangGraph graph (a fixed pipeline): Research -> settings -> Checkpoint 1 (plan) ->
Coding -> budget test drive (-> long-run approval) -> run with repair loop (-> ask for help) ->
Testing + Claim Scorecard -> Gap Detective -> finalize (Lab Memory).

Checkpoints use LangGraph interrupts with a Postgres checkpointer, so a crash or restart does
not lose work. Every checkpoint is two nodes: `ask_*` (side effects: DB row, events) and
`wait_*` (only `interrupt()`), because a node is re-executed from the start on resume.
"""
from __future__ import annotations

import json
import logging
from typing import TypedDict

from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from . import bus, change, coding, db, gap, memory, planner, research, resources, steps, testing
from .config import settings as cfg
from .observer import edge, node
from .project import fmt, fresh_project, load_settings, pdir, run_row

log = logging.getLogger("lab.graph")


class State(TypedDict, total=False):
    run_id: int
    outcome: str            # rejected | failed | completed
    help_reason: str
    help_instruction: str
    env: dict
    timeout: int
    long_run: dict
    plan_invalid: bool      # approval refused: no validated implementation plan exists
    verdict: str            # success | success_with_warnings | failed | blocked (from real test evidence)
    verdict_reason: str
    verdict_warnings: list


def _stage(run_id: int, stage: str, status: str = "running") -> None:
    db.ex("UPDATE runs SET stage=%s, status=%s WHERE id=%s", (stage, status, run_id))
    bus.emit(run_id, "system", "stage", f"Stage: {stage.replace('_', ' ')}", "", {"stage": stage})


def _brief(run_id: int) -> dict:
    return json.loads((pdir(run_id) / "research" / "brief.json").read_text(encoding="utf-8"))


def _ask(run_id: int, name: str, payload: dict, message: str) -> None:
    db.ex("""INSERT INTO checkpoints (run_id, name, payload) VALUES (%s,%s,%s)
             ON CONFLICT (run_id, name) WHERE status='pending' DO UPDATE SET payload=EXCLUDED.payload""",
          (run_id, name, db.J(payload)))
    db.ex("UPDATE runs SET status='waiting_approval' WHERE id=%s", (run_id,))
    bus.emit(run_id, "system", "checkpoint_waiting", message, "The researcher stays in control of important steps",
             {"checkpoint": name})


# ---------- nodes ----------

def n_start(s: State) -> State:
    run_id = s["run_id"]
    r = run_row(run_id)
    db.ex("UPDATE runs SET status='running', started_at=COALESCE(started_at, now()) WHERE id=%s", (run_id,))
    ch = change.for_run(run_id)
    if ch:  # a new version: its own copy of the source version's code, never the source folder
        _stage(run_id, "research")
        try:
            change.start_version(run_id, ch)
        except Exception as e:  # noqa: BLE001 - the version fails visibly; the source version is untouched
            db.ex("UPDATE change_requests SET status='failed', updated_at=now() WHERE id=%s", (ch["id"],))
            raise RuntimeError(f"could not create the new version: {e}") from e
        bus.emit(run_id, "system", "plan_ready", "Plan: reuse research -> revised plan approval -> Coding -> Testing",
                 "Coding waits for you to approve the revised plan")
        return {}
    fresh_project(run_id)
    _stage(run_id, "research")
    with steps.step(run_id, "research.paper_reader", "Getting the paper (arXiv LaTeX source and PDF, or the upload)",
                    "arXiv source files give exact equations and numbers with no OCR mistakes") as t:
        docs = research.acquire_papers(run_id, r["workspace_id"])
        if not docs:
            raise RuntimeError("no paper could be read (upload a PDF or a valid arXiv link)")
        t.notes = ", ".join(d.title[:60] for d in docs)
    nodes = [node(f"paper:{d.id}", "paper", d.title[:60], "working") for d in docs]
    bus.emit(run_id, "system", "plan_ready", "Plan: Research -> plan approval -> Coding -> Testing -> Gap analysis",
             "Coding waits for the researcher to approve the plan", {"map_nodes": nodes})
    return {}


def n_research(s: State) -> State:
    run_id = s["run_id"]
    ch = change.for_run(run_id)
    if ch:
        change.targeted_research(run_id, ch)
        return {}
    r = run_row(run_id)
    ws = db.q1("SELECT * FROM workspaces WHERE id=%s", (r["workspace_id"],))
    docs = research.acquire_papers(run_id, r["workspace_id"])
    infos = []
    reader = "research.paper_reader"
    for d in docs:
        with steps.step(run_id, reader, f"Reading '{d.title[:70]}': claims, settings and missing details",
                       "Every number the paper claims becomes a row in the Claims List with its page") as t:
            info = research.extract(run_id, d, ws["note"] or "")
            infos.append(info)
            t.notes = f"{len(info['claims'])} claims"
            bus.emit(run_id, reader, "claims_found", f"Claims List: {len(info['claims'])} claims in '{d.title[:60]}'",
                     "Saved with page and position for the PDF highlight", {"paper_id": d.id})
    finder = "research.source_finder"
    from . import recipes
    recipe = recipes.find(docs[0].title, docs[0].arxiv_id, docs[0].text)
    with steps.step(run_id, finder, "Finding and checking code, datasets and related papers",
                   "Official, licence, size and fit to the compute budget are checked for each source") as t:
        sources = research.find_sources(run_id, r["workspace_id"], docs, recipe)
        t.notes = sources["recommendation"][:300]
    brief = research.write_brief(run_id, r["workspace_id"], infos, sources, docs)
    nodes, edges_ = research.map_for_brief(brief)
    res = brief["sources"]["resources"]
    counts = {}
    for r_ in res["recommendations"]:
        counts[r_["category"]] = counts.get(r_["category"], 0) + 1
    bus.emit(run_id, "research.source_finder", "resources_ready", f"Resource review {res['status']}: {res['note']}",
             "Discovery and comparison finished before the plan is approved; your original resources are never replaced without your decision",
             {"status": res["status"], "counts": counts, "providers": res["providers"]})
    bus.emit(run_id, reader, "brief_ready", "Research Brief ready: " + sources["recommendation"][:200], "",
             {"map_nodes": nodes, "map_edges": edges_, "file": "research/brief.md"})
    return {}


def n_settings(s: State) -> State:
    run_id = s["run_id"]
    if change.for_run(run_id):  # settings were copied from the source version
        return {}
    coding.plan_settings(run_id, _brief(run_id), run_row(run_id)["compute_budget"])
    return {}


def n_ask_plan(s: State) -> State:
    run_id = s["run_id"]
    brief = _brief(run_id)
    payload = {"brief_file": "research/brief.md",
               "papers": [{"title": p["title"], "claims": len(p["claims"]), "recommendation": brief["sources"]["recommendation"]}
                          for p in brief["papers"]],
               "settings": load_settings(run_id),
               "actions": ["approve", "edit", "reject"]}
    review = _plan_review(run_id, brief, reuse=bool(s.get("plan_invalid")))
    payload["implementation_plans"] = review
    payload["plan_ready"] = review.get("ready") is not None
    _stage(run_id, "plan_approval", "waiting_approval")
    _ask(run_id, "plan", payload, "Checkpoint 1: review the Research Map and plan, then approve, edit or reject")
    return {}


def _plan_review(run_id: int, brief: dict, reuse: bool = False, decisions: list | None = None) -> dict:
    """Initial + optimized implementation plans (both kept). Re-asking after a refused approval reuses the saved review."""
    path = pdir(run_id) / "research" / "plan_review.json"
    if reuse and path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    note = (db.q1("SELECT w.note FROM workspaces w JOIN runs r ON r.workspace_id=w.id WHERE r.id=%s", (run_id,)) or {}).get("note", "")
    note = ((note or "") + "\n" + change.plan_note(run_id)).strip()
    return planner.build_plans(run_id, brief, note, decisions if decisions is not None else resources.decisions_for(run_id, brief))


def n_wait_plan(s: State) -> State:
    resp = interrupt({"checkpoint": "plan"})
    run_id = s["run_id"]
    action = (resp or {}).get("action", "approve")
    if action == "reject":
        bus.emit(run_id, "system", "run_rejected", "The researcher rejected the plan; the run stops here", "")
        return {"outcome": "rejected"}
    rv = pdir(run_id) / "research" / "plan_review.json"
    # Resource decisions made while reviewing the plan: re-plan so the planner and optimizer use them.
    if rv.exists() and action in ("approve", "edit"):
        brief = _brief(run_id)
        decisions = resources.decisions_for(run_id, brief)
        if decisions != (json.loads(rv.read_text(encoding="utf-8")).get("resource_decisions") or []):
            bus.emit(run_id, "planning.initial", "resources_applied", f"Re-planning with your {len(decisions)} resource decision(s)",
                     "Accepted resources must be used by the plan; rejected ones are never reselected")
            _plan_review(run_id, brief, reuse=False, decisions=decisions)
    if rv.exists() and json.loads(rv.read_text(encoding="utf-8")).get("ready") is None:
        bus.emit(run_id, "system", "plan_blocked", "Coding was not started: no implementation plan passed validation",
                 "Coding only starts from an approved plan that passed the quality gate; edit or reject the plan")
        return {"plan_invalid": True, "outcome": ""}
    if action == "edit":
        structured = coding.apply_setting_changes(run_id, resp.get("changes") or {}, resp.get("instruction", ""))
        changes = structured + (coding.apply_researcher_edit(run_id, resp["instruction"]) if resp.get("instruction", "").strip() else [])
        bus.emit(run_id, "system", "plan_edited",
                 "Plan edited: " + (", ".join(changes) if changes else "instruction passed to the agents"),
                 resp.get("instruction", ""), {"changes": changes})
        bus.r.rpush(f"lab:run:{run_id}:instructions", json.dumps({"agent": "run", "text": resp.get("instruction", "")}))
    return {"outcome": "", "plan_invalid": False}


def n_code(s: State) -> State:
    run_id = s["run_id"]
    _stage(run_id, "coding")
    if change.for_run(run_id):
        try:
            change.apply_changes(run_id)
        except change.ChangeFailed as e:
            return {"help_reason": str(e)}
        return {"help_reason": ""}
    try:
        coding.write_code(run_id, _brief(run_id))
    except coding.NoCodeSource as e:
        return {"help_reason": str(e)}
    coding.review(run_id, _brief(run_id))
    return {"help_reason": ""}


def n_budget(s: State) -> State:
    run_id = s["run_id"]
    budget = run_row(run_id)["compute_budget"]
    limit = coding.BUDGET_SECONDS[budget]
    ok, tail = coding.ensure_installed(run_id)
    if not ok:
        return {"help_reason": "Installation keeps failing:\n" + tail[-1500:], "timeout": int(limit * 1.5)}
    est = coding.test_drive(run_id, budget)
    timeout = int(max(limit * 1.5, 120))
    if est["estimated_seconds"] > limit * 1.1:
        frac = max(0.1, round(limit / est["estimated_seconds"], 2))
        return {"timeout": timeout, "long_run": {
            "estimated_seconds": round(est["estimated_seconds"]), "budget_seconds": limit,
            "options": [
                {"id": "reduce", "label": f"Use {int(frac * 100)}% of the training epochs (about {limit // 60} min)", "fraction": frac},
                {"id": "full", "label": f"Run the full plan (about {round(est['estimated_seconds'] / 60)} min)"},
            ]}}
    return {"timeout": timeout, "long_run": {}}


def n_ask_long_run(s: State) -> State:
    run_id = s["run_id"]
    lr = s["long_run"]
    _ask(run_id, "long_run", lr, f"The full run needs about {round(lr['estimated_seconds'] / 60)} min but the budget is "
         f"{lr['budget_seconds'] // 60} min: choose an option")
    return {}


def n_wait_long_run(s: State) -> State:
    resp = interrupt({"checkpoint": "long_run"}) or {}
    run_id = s["run_id"]
    if resp.get("action") == "reject":
        return {"outcome": "rejected"}
    lr = s["long_run"]
    option = resp.get("option") or ("full" if resp.get("action") == "approve" and not resp.get("option") else "reduce")
    if option == "reduce":
        frac = next(o["fraction"] for o in lr["options"] if o["id"] == "reduce")
        from .project import record_settings
        record_settings(run_id, [{"name": "budget_fraction", "value": frac, "source": "compute_change",
                                  "reason": "researcher chose a shorter run to fit the budget", "paper_value": "1"}])
        bus.emit(run_id, "system", "budget_choice", f"Running with {int(frac * 100)}% of the planned epochs", "Researcher's choice")
        return {"env": {"LAB_BUDGET_FRACTION": str(frac)}, "outcome": ""}
    return {"timeout": int(lr["estimated_seconds"] * 1.5), "env": {}, "outcome": ""}


def n_execute(s: State) -> State:
    run_id = s["run_id"]
    _stage(run_id, "coding")
    res, tail = coding.repair_and_run(run_id, s.get("timeout", 600), s.get("env") or {},
                                      s.get("help_instruction", ""))
    if res is None:
        return {"help_reason": tail[:4000]}
    coding.confirm_fixes(run_id, True)
    nodes = [node("result:metrics", "result", "metrics.json", "done")]
    bus.emit(run_id, "coding.writer", "results_ready",
             f"Run finished: {len(res.metrics)} numbers recorded from results/metrics.json (code {res.code_version})",
             "Every number is linked to this run, its code version and log line",
             {"exec_id": res.exec_id, "map_nodes": nodes,
              "map_edges": [edge("file:src/train.py", "result:metrics", "produced")]})
    return {"help_reason": "", "help_instruction": ""}


def n_ask_help(s: State) -> State:
    run_id = s["run_id"]
    _ask(run_id, "help", {"problem": s["help_reason"][:4000], "actions": ["approve", "edit", "reject"],
                          "hint": "Edit with an instruction (e.g. 'use torch 2.2'), approve to retry, reject to stop"},
         "The agents need help: " + s["help_reason"].splitlines()[0][:200])
    return {}


def n_wait_help(s: State) -> State:
    resp = interrupt({"checkpoint": "help"}) or {}
    if resp.get("action") == "reject":
        return {"outcome": "failed"}
    return {"help_instruction": resp.get("instruction", ""), "help_reason": "", "outcome": ""}


def n_test(s: State) -> State:
    run_id = s["run_id"]
    _stage(run_id, "testing")
    testing.design_tests(run_id)
    verdict = testing.run_and_repair(run_id)
    bus.emit(run_id, "testing.runner", "test_verdict",
             f"Test verdict: {verdict['status'].replace('_', ' ')}" + (f" ({verdict['reason']})" if verdict["reason"] else ""),
             "Decided from the tests that actually ran, never from a model summary",
             {"verdict": verdict["status"], "warnings": verdict["warnings"], "history": verdict["history"]})
    rows = testing.compute_scorecard(run_id)
    primary = next((r for r in rows if r["claim"]["metric_name"] == _primary_name(run_id)), rows[-1] if rows else None)
    if primary:
        db.ex("UPDATE runs SET primary_metric=%s, primary_higher_is_better=%s WHERE id=%s",
              (primary["claim"]["metric_name"], primary["claim"]["higher_is_better"], run_id))
    return {"verdict": verdict["status"], "verdict_reason": verdict["reason"], "verdict_warnings": verdict["warnings"]}


def _primary_name(run_id: int) -> str:
    from . import recipes
    b = _brief(run_id)["papers"][0]
    r = recipes.find(b.get("title", ""), b.get("arxiv_id", ""), b.get("summary", ""))
    return r.PRIMARY_METRIC if r else ""


def n_gap(s: State) -> State:
    run_id = s["run_id"]
    rows = db.q("""SELECT c.*, se.status FROM scorecard_entries se JOIN claims c ON c.id=se.claim_id
                   WHERE se.run_id=%s AND se.status IN ('different','close') ORDER BY (se.status='different') DESC, c.id""", (run_id,))
    if not rows:
        return {}
    _stage(run_id, "gap")
    r = run_row(run_id)
    primary = r["primary_metric"]
    rows.sort(key=lambda c: c["metric_name"] != primary)
    limit = 1 if r["compute_budget"] == "quick" else 2
    timeout = max(120, int(coding.BUDGET_SECONDS[r["compute_budget"]] * 1.5))
    for c in rows[:limit]:
        gap.investigate(run_id, c, _brief(run_id), r["compute_budget"], timeout)
    return {}


def n_finalize(s: State) -> State:
    run_id = s["run_id"]
    if s.get("verdict") in ("failed", "blocked"):  # required validation did not pass: never report success
        reason = s.get("verdict_reason") or "Required tests did not pass"
        db.ex("UPDATE runs SET status='failed', stage='testing', error=%s, finished_at=now() WHERE id=%s", (reason[:1000], run_id))
        bus.emit(run_id, "system", "run_failed", f"Run #{run_id} did not pass validation: {reason}",
                 "Required tests failed or could not run, so the version is not marked successful",
                 {"verdict": s["verdict"], "next_action": "Open the Code sandbox, fix the failing tests, then re-run"})
        return {"outcome": "failed"}
    r = run_row(run_id)
    brief = _brief(run_id)
    metrics = db.q("SELECT name, value FROM metrics WHERE run_id=%s ORDER BY id", (run_id,))
    score = db.q("SELECT status, count(*) AS n FROM scorecard_entries WHERE run_id=%s GROUP BY status", (run_id,))
    counts = {x["status"]: x["n"] for x in score}
    title = brief["papers"][0]["title"]
    memory.add("experiment", f"{title}: {r['compute_budget']} budget, " + ", ".join(f"{m['name']}={fmt(m['value'])}" for m in metrics[-6:]),
               {"run_id": run_id, "metrics": {m["name"]: m["value"] for m in metrics}, "scorecard": counts}, run_id)
    memory.add("setting", f"Settings that ran for '{title}' on the {r['compute_budget']} budget",
               {"settings": load_settings(run_id), "field": brief["papers"][0].get("field", "")}, run_id)
    total = sum(counts.values())
    msg = (f"Run #{run_id} finished: {counts.get('match', 0)} of {total} claims matched"
           + (f", {counts.get('close', 0)} close" if counts.get("close") else "")
           + (f", {counts.get('different', 0)} different (explained by the Gap Detective)" if counts.get("different") else ""))
    note = [f"# Run #{run_id} summary", "", msg, "", "| Metric | Value |", "|---|---|"]
    note += [f"| {m['name']} | {fmt(m['value'])} |" for m in metrics]
    db.ex("""INSERT INTO notes (workspace_id, run_id, author_type, author, title, markdown)
             VALUES (%s,%s,'agent','system',%s,%s)""", (r["workspace_id"], run_id, f"Run #{run_id} summary", "\n".join(note)))
    db.ex("UPDATE runs SET status='completed', stage='push', finished_at=now() WHERE id=%s", (run_id,))
    bus.emit(run_id, "system", "run_completed", msg, "Results are ready; publish to Hugging Face when you are happy",
             {"scorecard": counts, "verdict": s.get("verdict") or "success", "warnings": s.get("verdict_warnings") or []})
    return {"outcome": "completed"}


# ---------- routing ----------

def after_wait_plan(s: State) -> str:
    if s.get("plan_invalid"):
        return "ask_plan"
    return END if s.get("outcome") == "rejected" else "code"


def after_code(s: State) -> str:
    return "ask_help" if s.get("help_reason") else "budget"


def after_budget(s: State) -> str:
    if s.get("help_reason"):
        return "ask_help"
    return "ask_long_run" if s.get("long_run") else "execute"


def after_wait_long_run(s: State) -> str:
    return END if s.get("outcome") == "rejected" else "execute"


def after_execute(s: State) -> str:
    return "ask_help" if s.get("help_reason") else "test"


def after_test(s: State) -> str:
    return "finalize" if s.get("verdict") in ("failed", "blocked") else "gap"  # no gap analysis on broken code


def after_wait_help(s: State) -> str:
    if s.get("outcome") == "failed":
        return END
    # code was never written (no AI and no recipe) -> try writing again, otherwise run again
    return "code" if not (pdir(s["run_id"]) / "src").exists() else "execute"


def build(checkpointer):
    g = StateGraph(State)
    for name, fn in [("start", n_start), ("research", n_research), ("settings", n_settings), ("ask_plan", n_ask_plan),
                     ("wait_plan", n_wait_plan), ("code", n_code), ("budget", n_budget), ("ask_long_run", n_ask_long_run),
                     ("wait_long_run", n_wait_long_run), ("execute", n_execute), ("ask_help", n_ask_help),
                     ("wait_help", n_wait_help), ("test", n_test), ("gap", n_gap), ("finalize", n_finalize)]:
        g.add_node(name, fn)
    g.add_edge(START, "start")
    g.add_edge("start", "research")
    g.add_edge("research", "settings")
    g.add_edge("settings", "ask_plan")
    g.add_edge("ask_plan", "wait_plan")
    g.add_conditional_edges("wait_plan", after_wait_plan, ["code", "ask_plan", END])
    g.add_conditional_edges("code", after_code, ["ask_help", "budget"])
    g.add_conditional_edges("budget", after_budget, ["ask_help", "ask_long_run", "execute"])
    g.add_edge("ask_long_run", "wait_long_run")
    g.add_conditional_edges("wait_long_run", after_wait_long_run, ["execute", END])
    g.add_conditional_edges("execute", after_execute, ["ask_help", "test"])
    g.add_edge("ask_help", "wait_help")
    g.add_conditional_edges("wait_help", after_wait_help, ["code", "execute", END])
    g.add_conditional_edges("test", after_test, ["gap", "finalize"])
    g.add_edge("gap", "finalize")
    g.add_edge("finalize", END)
    return g.compile(checkpointer=checkpointer)


_graph = None


def _unpooled(url: str) -> str:
    """Connection poolers (e.g. Neon's '-pooler' endpoint, PgBouncer) reject the search_path startup
    option the checkpointer needs, so it uses the direct endpoint. LANGGRAPH_DATABASE_URL overrides."""
    import os

    return os.environ.get("LANGGRAPH_DATABASE_URL") or url.replace("-pooler.", ".", 1)


def get_graph():
    global _graph
    if _graph is None:
        # LangGraph's own tables (checkpoints, checkpoint_writes, ...) live in a separate schema so they
        # never clash with the application's tables (we have our own approval "checkpoints" table).
        db.ex("CREATE SCHEMA IF NOT EXISTS langgraph")
        cp_pool = ConnectionPool(_unpooled(cfg.database_url), min_size=1, max_size=6,
                                 kwargs={"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row,
                                         "options": "-c search_path=langgraph"})
        saver = PostgresSaver(cp_pool)
        saver.setup()
        _graph = build(saver)
    return _graph
