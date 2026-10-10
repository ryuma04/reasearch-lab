"""Gap Detective (Hero 3): tests the reason for a difference instead of guessing.

1. list every difference between our setup and the paper's (settings that are assumptions or
   compute changes), 2. rank them, 3. for the top ones run a small experiment that changes only
   that one thing, 4. measure how much each closes the gap, 5. explain with the evidence.
All numbers in the explanation are inserted from the database; AI-written text is passed
through the Go proof checker.
"""
from __future__ import annotations

from . import api, bus, db, llm, recipes, steps
from .observer import edge, node
from .project import create_child_run, finish_run, fmt, latest_metric, load_settings, set_config_values

MAX_EXPERIMENTS = {"quick": 2, "standard": 3, "deep": 3}


def differences(run_id: int, brief: dict) -> list[dict]:
    paper = brief["papers"][0]
    recipe = recipes.find(paper.get("title", ""), paper.get("arxiv_id", ""), paper.get("summary", ""))
    current = {s["name"]: s for s in load_settings(run_id)}
    diffs = []
    if recipe:
        for a in recipe.GAP_ABLATIONS:
            s = current.get(a["setting"])
            if not s:
                continue
            if "factor" in a:
                new = min(int(float(s["value"]) * a["factor"]), a.get("max", 10**9))
            else:
                new = a["value"]
            if str(new) == str(s["value"]):
                continue
            change = {a["setting"]: new, **{k: new for k in a.get("also", []) if k in current}}
            diffs.append({"setting": a["setting"], "ours": s["value"], "paper": s.get("paper_value") or "", "test_value": new,
                          "change": change, "label": a["label"], "likely": a["likely"], "reason": a["why"]})
    else:
        for s in current.values():
            if s["source"] in ("compute_change", "assumption"):
                diffs.append({"setting": s["name"], "ours": s["value"], "paper": s.get("paper_value") or "not stated",
                              "test_value": None, "change": {}, "label": f"change {s['name']}",
                              "likely": "high" if s["source"] == "compute_change" else "medium", "reason": s["reason"]})
        if llm.available() and diffs:
            data, _ = llm.chat_json("planner", "You are the Gap Detective. For each setup difference propose a single test "
                                    'value closer to the paper that still runs on a laptop CPU. JSON: {"tests": [{"setting": '
                                    '"...", "test_value": ..., "likely": "high|medium|low"}]}', str(diffs[:8]))
            for tst in (data or {}).get("tests", []) if isinstance(data, dict) else []:
                for d in diffs:
                    if d["setting"] == tst.get("setting") and tst.get("test_value") is not None:
                        d["test_value"] = tst["test_value"]
                        d["change"] = {d["setting"]: tst["test_value"]}
                        d["likely"] = tst.get("likely", d["likely"])
    order = {"high": 0, "medium": 1, "low": 2}
    diffs.sort(key=lambda d: order.get(d["likely"], 3))
    return diffs


def investigate(run_id: int, claim: dict, brief: dict, budget: str, timeout: int) -> dict:
    slug = "gap_detective"
    base = latest_metric(run_id, claim["metric_name"])
    with steps.step(run_id, slug, f"Testing why '{claim['description']}' differs from the paper",
                   "We answer with evidence from small experiments, not guesses") as t:
        diffs = differences(run_id, brief)
        bus.emit(run_id, slug, "gap_differences",
                 f"Found {len(diffs)} differences from the paper's setup: " + "; ".join(d["label"] for d in diffs[:4]),
                 "Ranked by how likely they are to matter (compute changes and assumptions first)",
                 {"claim_id": claim["id"], "differences": diffs})
        experiments = []
        for d in [d for d in diffs if d["change"]][:MAX_EXPERIMENTS.get(budget, 2)]:
            bus.check_control(run_id)
            child = create_child_run(run_id, "gap_test", f"gap/{d['setting']}")
            set_config_values(child, d["change"], "compute_change", f"Gap Detective: {d['label']}")
            bus.emit(child, slug, "gap_experiment", f"Experiment: {d['label']} ({d['setting']} {d['ours']} -> {d['test_value']})",
                     "Changes only this one thing", {"parent_run_id": run_id,
                     "map_nodes": [node(f"gap:{child}", "experiment", d["label"], "working")],
                     "map_edges": [edge(f"claim:{claim['id']}", f"gap:{child}", "tested by")]})
            res = api.sandbox_exec(child, "execute", "python src/train.py", timeout, slug)
            t.sandbox_seconds += res.seconds
            m = next((x for x in res.metrics if x["name"] == claim["metric_name"]), None)
            finish_run(child, "completed" if m else "failed", "" if m else (res.metrics_error or "run failed"))
            experiments.append({**d, "child_run_id": child, "metric_id": m["id"] if m else None,
                                "value": m["value"] if m else None})
            bus.emit(child, slug, "gap_result",
                     f"{d['label']}: {claim['metric_name']} = {fmt(m['value']) if m else 'failed'}", "",
                     {"metric_id": m["id"] if m else None,
                      "map_nodes": [node(f"gap:{child}", "experiment", d["label"], "done" if m else "problem")]})
        explanation = explain(run_id, claim, base, experiments, diffs)
        db.ex("""INSERT INTO gap_analyses (run_id, claim_id, differences, experiments, explanation) VALUES (%s,%s,%s,%s,%s)""",
              (run_id, claim["id"], db.J([{k: d[k] for k in ("setting", "ours", "paper", "reason", "label", "likely")} for d in diffs]),
               db.J([{k: e.get(k) for k in ("setting", "label", "child_run_id", "metric_id", "value", "test_value")} for e in experiments]),
               explanation))
        db.ex("UPDATE scorecard_entries SET explanation=%s WHERE run_id=%s AND claim_id=%s", (explanation, run_id, claim["id"]))
        t.notes = f"{len(experiments)} experiments"
        bus.emit(run_id, slug, "gap_explained", explanation[:1500], "Each reason was tested with its own small experiment",
                 {"claim_id": claim["id"]})
    return {"experiments": experiments, "explanation": explanation}


def explain(run_id: int, claim: dict, base: dict | None, experiments: list[dict], diffs: list[dict]) -> str:
    """Plain explanation; every number is taken from the database."""
    if not base:
        return "Our run did not produce this metric, so the gap could not be analysed."
    paper_v, ours = float(claim["value"]), float(base["value"])
    gap = ours - paper_v
    lower = not claim["higher_is_better"]
    parts = [f"Our result for '{claim['description']}' is {fmt(ours)}; the paper reports {fmt(paper_v)}."]
    best = None
    for e in experiments:
        if e["value"] is None:
            parts.append(f"The experiment '{e['label']}' failed to run.")
            continue
        closed = (ours - e["value"]) if lower else (e["value"] - ours)
        share = closed / abs(gap) if gap else 0
        if closed > 0:
            parts.append(f"{e['label'].capitalize()} changed it to {fmt(e['value'])} (run #{e['child_run_id']}), "
                         f"closing about {fmt(round(min(share, 1.0) * 100))}% of the gap.")
        else:
            parts.append(f"{e['label'].capitalize()} gave {fmt(e['value'])} (run #{e['child_run_id']}), which did not close the gap.")
        if closed > 0 and (best is None or closed > best[1]):
            best = (e, closed)
    if best:
        parts.insert(1, f"Most of the gap comes from: {best[0]['reason']}.")
    untested = [d for d in diffs if not any(e["setting"] == d["setting"] for e in experiments)]
    if untested:
        parts.append("Not tested within this budget: " + ", ".join(d["label"] for d in untested[:3]) + ".")
    text = " ".join(parts)
    if llm.available():
        res = llm.chat("writer", "Rewrite this result explanation in plain, friendly words for a researcher. Keep every "
                       "number exactly as given and do not add new numbers. Max 90 words.", text, max_tokens=300)
        if res and res.text:
            checked = api.proof_check(run_id, res.text.strip())
            if checked.get("clean_text") and not checked.get("flagged"):
                return checked["clean_text"]
    return text
