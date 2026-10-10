"""What-If Branches (Hero 5) with successive halving.

A question becomes several branches (child runs, each its own git branch on push). All start
with a small budget; after the first round the weaker half is stopped early and the rest run
with the full budget.
"""
from __future__ import annotations

import logging
import re
from concurrent.futures import ThreadPoolExecutor

from . import api, bus, db, llm, team
from .coding import BUDGET_SECONDS
from .observer import edge, node
from .project import create_child_run, finish_run, fmt, load_settings, run_row, set_config_values

log = logging.getLogger("lab.whatif")

ROUND1_FRACTION = 0.34
MAX_BRANCHES = 4


def parse(question: str, setting_names: list[str]) -> list[dict]:
    """Question -> branches [{label, change}]. AI first, then simple patterns."""
    branches: list[dict] = []
    if llm.available():
        data, _ = llm.chat_json("planner", "Turn a researcher's what-if question into 2-4 small experiments. Each changes "
                                'existing config settings only. JSON: {"branches": [{"label": "short-label", "change": '
                                '{"setting.name": value}}]}', f"Settings: {setting_names}\nQuestion: {question}")
        if isinstance(data, dict):
            for b in data.get("branches") or []:
                change = {k: v for k, v in (b.get("change") or {}).items() if k in setting_names}
                if change:
                    branches.append({"label": str(b.get("label") or "branch")[:40], "change": change})
    if branches:
        return branches[:MAX_BRANCHES]

    q = question.lower()
    nums = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", q)]
    as_num = lambda x: int(x) if float(x).is_integer() else x  # noqa: E731
    by_kw = [("temperature", "temp"), ("epoch", "epochs"), ("batch", "bs"), ("learning rate", "lr"), ("lr", "lr"),
             ("hidden", "hidden"), ("units", "hidden"), ("subset", "n"), ("images", "n"), ("alpha", "alpha")]
    for kw, short in by_kw:
        if kw in q and nums:
            keys = [k for k in setting_names if kw.split()[0] in k or (short == "hidden" and "student_hidden" in k)
                    or (short == "lr" and k.endswith(".lr")) or (short == "n" and "subset" in k)]
            if short == "hidden":
                keys = [k for k in setting_names if "student_hidden" in k] or [k for k in setting_names if "hidden" in k]
            if keys:
                for v in nums[:MAX_BRANCHES]:
                    branches.append({"label": f"{short}-{fmt(v)}", "change": {k: as_num(v) for k in keys}})
                break
    if not branches and "fashion" in q:
        key = next((k for k in setting_names if k.endswith("dataset")), None)
        if key:
            branches = [{"label": "fashion-mnist", "change": {key: "fashion_mnist"}}]
    return branches


def run_question(run_id: int, question_id: str, question: str) -> None:
    parent = run_row(run_id)
    budget = parent["compute_budget"]
    metric = parent["primary_metric"]
    higher = parent["primary_higher_is_better"]
    names = [s["name"] for s in load_settings(run_id)]
    slug = "manager"  # the Team Manager plans branches
    db.ex("DELETE FROM whatif_branches WHERE run_id=%s AND question_id=%s AND label='planning'", (run_id, question_id))

    with team.task(run_id, slug, "plan_team", f"Planning what-if branches for: {question}",
                   "Each branch is a small experiment that changes only what the question asks") as t:
        branches = parse(question, names)
        if not branches:
            t.outcome, t.notes = 0.0, "could not turn the question into settings changes"
            db.ex("""INSERT INTO whatif_branches (run_id, question_id, question, label, status, reason)
                     VALUES (%s,%s,%s,'not understood','failed','Could not map the question to settings of this project')""",
                  (run_id, question_id, question))
            bus.emit(run_id, slug, "whatif_failed", f"Could not turn '{question}' into experiments",
                     "No setting of this project matches the question")
            return
        t.outcome = 1.0
        t.notes = f"{len(branches)} branches"

    rows = []
    for b in branches:
        child = create_child_run(run_id, "whatif", f"whatif/{b['label']}")
        set_config_values(child, b["change"], "researcher", f"what-if: {question}")
        bid = db.scalar("""INSERT INTO whatif_branches (run_id, child_run_id, question_id, question, label, settings_change, status)
                           VALUES (%s,%s,%s,%s,%s,%s,'running') RETURNING id""",
                        (run_id, child, question_id, question, b["label"], db.J(b["change"])))
        rows.append({"id": bid, "child": child, **b, "value": None, "metric_id": None})
        bus.emit(child, "manager", "whatif_branch", f"Branch '{b['label']}': " + ", ".join(f"{k}={v}" for k, v in b["change"].items()),
                 "", {"branch_id": bid, "parent_run_id": run_id,
                      "map_nodes": [node(f"whatif:{child}", "whatif", b["label"], "working")],
                      "map_edges": [edge("result:metrics", f"whatif:{child}", "what if")]})

    timeout = max(120, int(BUDGET_SECONDS.get(budget, 300) * 1.5))
    coder = "coding.writer"

    def run_branch(r: dict, fraction: float, rnd: int) -> None:
        try:
            bus.check_control(run_id)
            needs_data = any(k.endswith("dataset") for k in r["change"])
            if needs_data and rnd == 1:
                api.sandbox_exec(r["child"], "install", "python src/download_data.py", 900, coder)
            res = api.sandbox_exec(r["child"], "execute", "python src/train.py", timeout, coder,
                                   env={"LAB_BUDGET_FRACTION": str(fraction)})
            m = next((x for x in res.metrics if x["name"] == metric), None)
            r["value"], r["metric_id"] = (m["value"], m["id"]) if m else (None, None)
            r["error"] = "" if m else (res.metrics_error or res.log_tail[-300:])
        except bus.RunStopped:
            r["error"] = "stopped"
        except Exception as e:  # noqa: BLE001
            log.exception("branch failed")
            r["error"] = str(e)
        db.ex("UPDATE whatif_branches SET round=%s, result_metric_id=%s WHERE id=%s", (rnd, r["metric_id"], r["id"]))

    # Round 1: every branch with a small budget, in parallel.
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda r: run_branch(r, ROUND1_FRACTION, 1), rows))

    ok = [r for r in rows if r["value"] is not None]
    for r in rows:
        if r["value"] is None:
            db.ex("UPDATE whatif_branches SET status='failed', reason=%s WHERE id=%s", (r.get("error", "")[:300], r["id"]))
            finish_run(r["child"], "failed", r.get("error", ""))
    ok.sort(key=lambda r: r["value"], reverse=higher)
    keep = ok[: max(1, (len(ok) + 1) // 2)] if len(ok) > 1 else ok
    for r in ok[len(keep):]:
        reason = (f"stopped early: clearly worse after the first short round ({metric} {fmt(r['value'])} vs "
                  f"{fmt(keep[-1]['value'])} for the weakest kept branch)")
        db.ex("UPDATE whatif_branches SET status='stopped_early', reason=%s WHERE id=%s", (reason, r["id"]))
        finish_run(r["child"], "stopped", "stopped early by successive halving")
        bus.emit(r["child"], "manager", "whatif_stopped", f"Branch '{r['label']}' {reason}", "Successive halving saves compute",
                 {"branch_id": r["id"], "map_nodes": [node(f"whatif:{r['child']}", "whatif", r["label"], "waiting", stopped=True)]})

    # Round 2: survivors with the full budget.
    if len(rows) > 1:
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(lambda r: run_branch(r, 1.0, 2), keep))
    final = [r for r in keep if r["value"] is not None]
    for r in keep:
        status = "done" if r["value"] is not None else "failed"
        db.ex("UPDATE whatif_branches SET status=%s, reason=COALESCE(NULLIF(%s,''), reason) WHERE id=%s",
              (status, r.get("error", "")[:300], r["id"]))
        finish_run(r["child"], "completed" if status == "done" else "failed", r.get("error", ""))
    final.sort(key=lambda r: r["value"], reverse=higher)
    base = db.q1("SELECT value FROM metrics WHERE run_id=%s AND name=%s ORDER BY id DESC LIMIT 1", (run_id, metric))
    if final:
        best = final[0]
        msg = (f"What-if '{question}': best branch '{best['label']}' with {metric} = {fmt(best['value'])} "
               f"(main run: {fmt(base['value']) if base else 'n/a'}); {len(rows) - len(keep)} branch(es) stopped early")
        db.ex("UPDATE whatif_branches SET reason='best branch' WHERE id=%s", (best["id"],))
        bus.emit(run_id, "manager", "whatif_finished", msg, "Numbers come from each branch's metrics.json",
                 {"question_id": question_id, "best_branch_id": best["id"], "metric_id": best["metric_id"],
                  "map_nodes": [node(f"whatif:{r['child']}", "whatif", r["label"], "done", best=(r is best)) for r in final]})
    else:
        bus.emit(run_id, "manager", "whatif_finished", f"What-if '{question}': no branch produced a result", "",
                 {"question_id": question_id})
    team.evolve(run_id)
