"""Implementation planning: Initial Implementation Planner (A) and Implementation Plan Optimizer (B).

Agent A drafts an executable task plan from the research brief. Agent B critiques that draft and returns an
improved plan plus the list of weaknesses it fixed. A deterministic validator (never a model) decides whether a
plan is ready for approval: required fields, valid dependencies, no cycles, tests present, every requirement
covered. Both plans are kept; if the optimizer fails or its plan does not validate, the initial plan is kept and
the failure is reported. Nothing here executes code.
"""
from __future__ import annotations

import json
import logging

from . import bus, db, llm
from .project import pdir

log = logging.getLogger("lab.planner")

TASK_FIELDS = ("id", "title", "description", "depends_on", "inputs", "outputs", "modules", "completion", "validation", "failure", "kind")
KINDS = {"research", "code", "test", "infra", "docs"}

PLAN_SCHEMA = (
    "Return JSON: {objective, scope, requirements:[{id,text}], reuse:[string], decisions:[string], "
    "tasks:[{id,title,description,depends_on:[task ids],inputs:[string],outputs:[string],modules:[string],"
    "completion,validation,failure,kind:one of research|code|test|infra|docs,requirement_ids:[requirement ids]}], "
    "risks:[string], assumptions:[string], external_dependencies:[string], acceptance:[string]}. "
    "Task ids are T1, T2, ... Every task needs a completion criterion, a validation procedure and a failure condition."
)

A_SYSTEM = ("You are the Initial Implementation Planner of an ML paper-reproduction lab. Write a concrete, ordered task plan "
            "that reproduces the paper's main results on a CPU laptop using only what the brief states. " + PLAN_SCHEMA)
B_SYSTEM = ("You are the Implementation Plan Optimizer. You receive the research brief and an initial plan. Do NOT copy the plan: "
            "find its weaknesses (missing tasks, wrong order, missing dependencies, untested steps, unmeasurable acceptance "
            "criteria, unstated risks or external dependencies) and return an improved plan. Do not add frameworks or services "
            "the task does not need. " + PLAN_SCHEMA +
            " Also return top-level keys: weaknesses:[{issue,fix}] and changes:{added:[task ids],removed:[task ids],"
            "reordered:[task ids],risks_added:[string],tests_added:[task ids],decisions:[string]}.")


# ---------- requirements and the deterministic fallback ----------

def requirements_from(brief: dict, note: str = "") -> list[dict]:
    reqs = []
    for p in brief.get("papers", []):
        for c in p.get("claims", []):
            reqs.append({"id": f"R{len(reqs) + 1}", "text": f"Reproduce and verify: {c.get('description', '')} (paper reports {c.get('value')} {c.get('unit', '')})".strip()})
    reqs.append({"id": f"R{len(reqs) + 1}", "text": "Every reported number is written by the code to results/metrics.json (no hand-typed results)"})
    if note.strip():
        reqs.append({"id": f"R{len(reqs) + 1}", "text": f"Researcher note: {note.strip()[:300]}"})
    return reqs


def used_resources(decisions: list[dict] | None) -> list[dict]:
    """Accepted or supplementary resources the plan must use."""
    return [d for d in (decisions or []) if d["decision"] in ("accept", "supplement")]


def template_plan(brief: dict, reqs: list[dict], decisions: list[dict] | None = None) -> dict:
    """A conventional reproduction plan that needs no AI; used when no model is available."""
    rid = [r["id"] for r in reqs]
    def t(i, title, deps, kind, modules, **kw):
        return {"id": f"T{i}", "title": title, "description": kw.get("description", title), "depends_on": [f"T{d}" for d in deps], "inputs": kw.get("inputs", []),
                "outputs": kw.get("outputs", []), "modules": modules, "completion": kw.get("completion", f"{title} is finished"),
                "validation": kw.get("validation", "Run the step in the sandbox and check its exit code"), "failure": kw.get("failure", "Non-zero exit code or missing output"),
                "kind": kind, "requirement_ids": kw.get("reqs", rid[:1])}
    tasks = [
        t(1, "Pin dependencies in requirements.txt", [], "infra", ["requirements.txt"], outputs=["requirements.txt"], completion="pip install succeeds in the sandbox",
          validation="Install step exits 0", failure="pip reports a version conflict"),
        t(2, "Load and split the data", [1], "code", ["src/download_data.py"], outputs=["data splits"], validation="Train and test data do not overlap",
          description="Load and split the data. " + " ".join(
              (f"Use the accepted {d['kind']} {d['name']} ({d['url']}) as the primary resource." if d["decision"] == "accept"
               else f"Use {d['kind']} {d['name']} ({d['url']}) as a supplement to {d.get('original') or 'the original'}, only if formats, labels and licences are compatible.")
              for d in used_resources(decisions)) + " " + " ".join(
              f"Do not use {d['name']} (rejected by the researcher)." for d in (decisions or []) if d["decision"] == "reject")),
        t(3, "Implement the model and training loop", [2], "code", ["src/models.py", "src/train.py"], outputs=["trained model"], reqs=rid[:-1] or rid),
        t(4, "Write measured results to results/metrics.json", [3], "code", ["src/train.py"], outputs=["results/metrics.json"],
          completion="metrics.json lists every claimed metric", validation="The Go API validates and records each number", reqs=rid[-1:] if len(rid) > 1 else rid),
        t(5, "Write and run correctness and claim tests", [4], "test", ["tests/"], outputs=["results/junit.xml"], completion="pytest produced results",
          validation="pytest exit code and junit.xml", failure="A required correctness test fails", reqs=rid),
    ]
    return {"objective": "Reproduce the paper's main reported results", "scope": "CPU-scale reproduction within the chosen compute budget",
            "requirements": reqs, "reuse": ["Existing sandbox, metrics proof and claim scorecard"], "decisions": ["Plain PyTorch, no extra services"],
            "tasks": tasks, "risks": ["Training budget is shorter than the paper's"], "assumptions": ["Unstated hyper-parameters use common defaults (marked in settings)"],
            "external_dependencies": ["PyPI packages", "Dataset download"], "acceptance": ["All required tests pass", "Every claim has a measured value"]}


# ---------- validation (deterministic) ----------

def validate(plan: dict, requirement_ids: list[str], decisions: list[dict] | None = None) -> dict:
    errors: list[str] = []
    warnings: list[str] = []
    tasks = plan.get("tasks") if isinstance(plan, dict) else None
    if not isinstance(tasks, list) or not tasks:
        return {"ok": False, "errors": ["The plan has no tasks"], "warnings": []}
    ids = [t.get("id") for t in tasks if isinstance(t, dict)]
    if len(ids) != len(set(ids)) or not all(ids):
        errors.append("Task ids are missing or duplicated")
    known = set(ids)
    for t in tasks:
        tid = t.get("id", "?")
        for f in ("title", "completion", "validation", "failure"):
            if not str(t.get(f) or "").strip():
                errors.append(f"{tid}: missing {f}")
        if t.get("kind") not in KINDS:
            errors.append(f"{tid}: kind must be one of {sorted(KINDS)}")
        for d in t.get("depends_on") or []:
            if d not in known:
                errors.append(f"{tid}: depends on unknown task {d}")
            if d == tid:
                errors.append(f"{tid}: depends on itself")
    if not errors and _has_cycle(tasks):
        errors.append("The task dependencies contain a cycle")
    if not any(t.get("kind") == "test" for t in tasks):
        errors.append("The plan has no test task")
    covered = {r for t in tasks for r in (t.get("requirement_ids") or [])}
    missing = [r for r in requirement_ids if r not in covered]
    if missing:
        errors.append("Requirements not covered by any task: " + ", ".join(missing))
    text = json.dumps(tasks).lower()
    for d in used_resources(decisions):
        if d["name"].lower() not in text and d["url"].lower() not in text:
            errors.append(f"The accepted {d['kind']} {d['name']} is not used by any task")
    if not plan.get("external_dependencies"):
        warnings.append("No external dependencies are listed")
    if not plan.get("assumptions"):
        warnings.append("No assumptions are listed (unsupported assumptions should be marked)")
    return {"ok": not errors, "errors": errors, "warnings": warnings}


def _has_cycle(tasks: list[dict]) -> bool:
    deps = {t["id"]: set(t.get("depends_on") or []) for t in tasks}
    done: set[str] = set()
    while deps:
        ready = [k for k, v in deps.items() if v <= done]
        if not ready:
            return True
        for k in ready:
            done.add(k)
            deps.pop(k)
    return False


def order(plan: dict) -> list[str]:
    """Task ids in a valid execution order (only meaningful for an acyclic plan)."""
    deps = {t["id"]: set(t.get("depends_on") or []) for t in plan.get("tasks", [])}
    out: list[str] = []
    while deps:
        ready = sorted(k for k, v in deps.items() if v <= set(out))
        if not ready:
            break
        out += ready
        for k in ready:
            deps.pop(k)
    return out


def diff(initial: dict, optimized: dict) -> dict:
    """What the optimizer changed, computed from the two plans (not taken from the model's own claim)."""
    a = {t["id"]: t for t in initial.get("tasks", [])}
    b = {t["id"]: t for t in optimized.get("tasks", [])}
    title = lambda t: f"{t['id']}: {t.get('title', '')}"  # noqa: E731
    oa, ob = order(initial), order(optimized)
    common = [i for i in ob if i in a]
    return {
        "added": [title(b[i]) for i in b if i not in a],
        "removed": [title(a[i]) for i in a if i not in b],
        "changed": [title(b[i]) for i in b if i in a and any(a[i].get(f) != b[i].get(f) for f in ("description", "depends_on", "completion", "validation", "modules"))],
        "reordered": [i for i in common if oa.index(i) != [x for x in oa if x in b].index(i)] if all(i in oa for i in common) else [],
        "tests_added": [title(b[i]) for i in b if i not in a and b[i].get("kind") == "test"],
        "risks_added": [r for r in optimized.get("risks", []) if r not in initial.get("risks", [])],
        "decisions_added": [d for d in optimized.get("decisions", []) if d not in initial.get("decisions", [])],
        "tasks": {"initial": len(a), "optimized": len(b)},
    }


# ---------- the two agents ----------

def _ask(agent: str, system: str, user: str) -> tuple[dict | None, dict]:
    acc: list[dict] = []
    tok = llm.invocations.set(acc)
    try:
        data, _ = llm.chat_json("planner", system, user, max_tokens=6000, agent=agent)
    finally:
        llm.invocations.reset(tok)
    return (data if isinstance(data, dict) else None), (acc[-1] if acc else {})


def _decision_text(decisions: list[dict] | None) -> str:
    if not decisions:
        return "Resource decisions: none yet (keep the researcher's original resources)."
    return ("Resource decisions by the researcher (follow them exactly; never reselect a rejected resource; use accepted ones as stated): "
            + json.dumps([{k: d[k] for k in ("kind", "name", "url", "decision", "note", "original")} for d in decisions]))


def _brief_text(brief: dict) -> str:
    keep = {"papers": [{k: p.get(k) for k in ("title", "summary", "method", "settings", "claims", "missing_details")} for p in brief.get("papers", [])],
            "sources": {k: (brief.get("sources") or {}).get(k) for k in ("repositories", "datasets", "recommendation")}}
    return json.dumps(keep, default=str)[:20000]


def initial_plan(brief: dict, reqs: list[dict], decisions: list[dict] | None = None) -> tuple[dict, str, dict]:
    """(plan, source, invocation metadata). Uses AI when available; otherwise (or when its plan does not validate) the template."""
    data, meta = _ask("planning_a", A_SYSTEM, f"Requirements: {json.dumps(reqs)}\n\n{_decision_text(decisions)}\n\nResearch brief: {_brief_text(brief)}")
    if data and validate(data, [r["id"] for r in reqs], decisions)["ok"]:
        data["requirements"] = data.get("requirements") or reqs
        return data, "ai", meta
    return template_plan(brief, reqs, decisions), "template", meta


def optimize(initial: dict, brief: dict, reqs: list[dict], decisions: list[dict] | None = None) -> tuple[dict | None, dict]:
    """The optimizer's own critique and improved plan, or (None, meta) when it fails: nothing is invented."""
    data, meta = _ask("planning_b", B_SYSTEM, f"Requirements: {json.dumps(reqs)}\n\n{_decision_text(decisions)}\n\nInitial plan: {json.dumps(initial)}\n\nResearch brief: {_brief_text(brief)}")
    return data, meta


def build_plans(run_id: int, brief: dict, note: str = "", decisions: list[dict] | None = None) -> dict:
    """Run both planning stages, validate, persist both plans, and decide which one (if any) may be approved."""
    reqs = requirements_from(brief, note)
    rids = [r["id"] for r in reqs]
    bus.emit(run_id, "planning.initial", "agent_started", "Drafting the initial implementation plan", "Planner A turns the research brief into ordered, testable tasks")
    initial, source, meta_a = initial_plan(brief, reqs, decisions)
    v_initial = validate(initial, rids, decisions)
    bus.emit(run_id, "planning.initial", "agent_finished", f"Initial plan: {len(initial['tasks'])} tasks ({source})", "",
             {"validation": v_initial, "provider": meta_a.get("provider"), "model": meta_a.get("model")})

    bus.emit(run_id, "planning.optimizer", "agent_started", "Critiquing and optimizing the initial plan", "Planner B must find weaknesses, not copy the plan")
    opt_raw, meta_b = optimize(initial, brief, reqs, decisions)
    optimized, v_opt, failure, weaknesses = None, None, "", []
    if opt_raw is None:
        failure = "The optimizer returned no usable plan (no AI provider available or invalid output); the initial plan is kept"
    else:
        weaknesses = opt_raw.pop("weaknesses", []) or []
        opt_raw.pop("changes", None)  # the diff is computed from the plans, not trusted from the model
        opt_raw["requirements"] = opt_raw.get("requirements") or reqs
        v_opt = validate(opt_raw, rids, decisions)
        if v_opt["ok"] and diff(initial, opt_raw)["tasks"]["optimized"] and (weaknesses or diff(initial, opt_raw)["added"] or diff(initial, opt_raw)["changed"]):
            optimized = opt_raw
        elif v_opt["ok"]:
            failure = "The optimizer made no meaningful change to the initial plan; the initial plan is kept"
        else:
            failure = "The optimized plan failed validation (" + "; ".join(v_opt["errors"][:3]) + "); the initial plan is kept"
    d = diff(initial, optimized) if optimized else None
    ready = "optimized" if optimized else ("initial" if v_initial["ok"] else None)
    review = {"initial": {"plan": initial, "source": source, "validation": v_initial, "invocation": meta_a},
              "optimized": {"plan": optimized, "validation": v_opt, "weaknesses": weaknesses, "diff": d, "invocation": meta_b, "failure": failure} if (optimized or failure) else None,
              "ready": ready, "requirements": reqs, "resource_decisions": decisions or []}
    bus.emit(run_id, "planning.optimizer", "agent_finished",
             ("Optimized plan ready: " + f"{len(d['added'])} tasks added, {len(d['changed'])} changed" if optimized else f"Optimization did not produce a plan: {failure}"),
             "", {"validation": v_opt, "provider": meta_b.get("provider"), "model": meta_b.get("model")})
    root = pdir(run_id) / "research"
    root.mkdir(parents=True, exist_ok=True)
    (root / "plan_initial.json").write_text(json.dumps(initial, indent=2), encoding="utf-8")
    if optimized:
        (root / "plan_optimized.json").write_text(json.dumps(optimized, indent=2), encoding="utf-8")
    (root / "plan_review.json").write_text(json.dumps(review, indent=2, default=str), encoding="utf-8")
    db.ex("INSERT INTO notes (workspace_id, run_id, author_type, author, title, markdown) "
          "SELECT workspace_id, id, 'agent', 'planning.optimizer', %s, %s FROM runs WHERE id=%s",
          (f"Implementation plans (run #{run_id})", to_markdown(review), run_id))
    return review


def to_markdown(review: dict) -> str:
    out = ["# Implementation plans", ""]
    for key, label in (("initial", "Initial plan"), ("optimized", "Optimized plan")):
        block = review.get(key)
        if not block or not block.get("plan"):
            if key == "optimized" and block:
                out += [f"## {label}", "", f"Not produced: {block.get('failure')}", ""]
            continue
        p = block["plan"]
        out += [f"## {label}", "", f"**Objective.** {p.get('objective', '')}", "", "| Task | Depends on | Kind | Completion |", "|---|---|---|---|"]
        out += [f"| {t['id']} {t.get('title', '')} | {', '.join(t.get('depends_on') or []) or '-'} | {t.get('kind')} | {t.get('completion', '')} |" for t in p["tasks"]]
        out += ["", f"Validation: {'passed' if block['validation']['ok'] else 'FAILED: ' + '; '.join(block['validation']['errors'])}", ""]
    return "\n".join(out)
