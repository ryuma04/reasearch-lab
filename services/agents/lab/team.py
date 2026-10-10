"""Team Manager (meta-controller), agent recipes, the reward loop and team evolution.

An agent is a recipe (agents + agent_versions rows): name, instructions, tools, model and
skill tags. Creating, refining, merging, replacing and retiring agents is therefore just
data, recorded in team_decisions with a one-line reason (Sections 8.1, 8.6 and 9).
"""
from __future__ import annotations

import logging
import random
import re
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, field

from . import bus, db, llm
from .observer import edge, node

log = logging.getLogger("lab.team")

# ---------- recipes ----------

CORE_AGENTS = [
    # slug, name, kind, parent, model role, skills, instructions
    ("manager", "Team Manager", "manager", "", "planner", ["plan_team", "assign_work", "evaluate_agents"],
     "Plan the work: make a skills list, match skills to agents by past score, create specialists for missing skills, "
     "decide order and parallelism, and give a one-line reason for every decision."),
    ("research.paper_reader", "Paper Reader", "core", "research", "long", ["read_paper", "extract_claims", "extract_settings"],
     "Get the paper text in the most accurate way (arXiv LaTeX source, then PDF text, then OCR). Produce a plain summary, "
     "the method step by step, every setting with its page, the Claims List (every reported result number with page, "
     "table and condition) and the Missing Details List."),
    ("research.source_finder", "Source Finder", "core", "research", "fast", ["find_sources", "check_licence"],
     "Study the uploaded repository and dataset, or search GitHub, Hugging Face, Semantic Scholar, OpenAlex, arXiv and "
     "Kaggle. Check if each source is official, its licence, its size and whether it fits the compute budget."),
    ("coding.writer", "Code Writer", "core", "coding", "planner", ["write_code", "pytorch_training", "data_loading"],
     "Write a clean project: data loading, model, training, evaluation and one configuration file with every setting. "
     "Every script writes its results to results/metrics.json. Pin exact versions in requirements.txt."),
    ("coding.reviewer", "Code Reviewer and Debugger", "core", "coding", "reviewer", ["review_code", "debug_code"],
     "Before running, review the code against the Research Brief. After running, read errors, search Lab Memory for a "
     "known fix first, then find the cause and fix it. Stop after the retry limit and ask the researcher."),
    ("testing.designer", "Test Designer", "core", "testing", "planner", ["design_tests"],
     "Write correctness tests (code does the right thing) and claim tests (each result vs the paper with a tolerance)."),
    ("testing.runner", "Test Runner", "core", "testing", "fast", ["run_tests", "compare_claims"],
     "Run all tests inside the sandbox and fill the Claim Scorecard: Match, Close or Different for every claim."),
    ("observer", "Observer", "observer", "", "fast", ["draw_map"],
     "Watch every event and keep the live research map of what each agent found and did."),
]

SPECIALIST_TEMPLATES = {
    "environment_fixer": ("Environment Fixer", "planner", ["fix_environment"],
                          "Installation failed repeatedly. Find compatible library versions (relax or change pins, use known "
                          "compatible sets) and fix the environment without changing the research code."),
    "dataset_subset_planner": ("Dataset Subset Planner", "fast", ["data_budgeting"],
                               "The dataset is too big for the compute budget. Pick a smaller, balanced subset and fewer epochs "
                               "that still give meaningful evidence; record every change as a compute_change setting."),
    "hyperparameter_scout": ("Hyperparameter Scout", "fast", ["hyperparameter_choice"],
                             "The paper does not state an important setting. Choose a sensible value (common default for "
                             "this model type, or a few quick trials) and record it as an assumption with the reason."),
    "domain_specialist": ("Domain Specialist", "planner", [],
                          "Give field-specific guidance and tools for this paper's domain to the other agents."),
    "gap_detective": ("Gap Detective", "writer", ["explain_gap"],
                      "A claim is Different. List every setup difference, rank them, run a small experiment changing only "
                      "one thing for the top differences, measure how much each closes the gap and explain with evidence."),
}

_seed_lock = threading.Lock()
_seeded = False


def seed() -> None:
    """Create the starting team once (idempotent)."""
    global _seeded
    if _seeded:
        return
    with _seed_lock:
        if _seeded:
            return
        for slug, name, kind, parent, role, skills, instr in CORE_AGENTS:
            if db.q1("SELECT id FROM agents WHERE slug=%s", (slug,)):
                continue
            stage = "active"
            _create_agent(slug, name, kind, parent, "", stage, instr, role, skills, "Starting team", run_id=None, decision=False)
        _seeded = True


def _create_agent(slug, name, kind, parent, template, stage, instructions, role, skills, reason, run_id, decision=True) -> int:
    with db.pool.connection() as c, c.transaction():
        aid = c.execute(
            "INSERT INTO agents (slug, name, kind, parent_slug, template, stage) VALUES (%s,%s,%s,%s,%s,%s) RETURNING id",
            (slug, name, kind, parent, template, stage)).fetchone()["id"]
        vid = c.execute(
            """INSERT INTO agent_versions (agent_id, version, instructions, tools, model, skill_tags, created_reason)
               VALUES (%s, 1, %s, %s, %s, %s, %s) RETURNING id""",
            (aid, instructions, db.J(["sandbox", "lab_memory"]), role, skills, reason)).fetchone()["id"]
        c.execute("UPDATE agents SET current_version_id=%s WHERE id=%s", (vid, aid))
    if decision:
        decide(run_id, "create", [aid], skills[0] if skills else "", reason)
    return aid


def decide(run_id, decision: str, agent_ids: list[int], skill: str, reason: str, status: str = "applied") -> None:
    db.ex("INSERT INTO team_decisions (run_id, decision, agent_ids, skill, reason, status) VALUES (%s,%s,%s,%s,%s,%s)",
          (run_id, decision, agent_ids, skill, reason, status))
    if run_id:
        bus.emit(run_id, "manager", "team_decision", f"{decision.capitalize()}: {reason}", reason,
                 {"decision": decision, "agent_ids": agent_ids, "skill": skill})


def agent(slug: str) -> dict | None:
    return db.q1("""SELECT a.*, v.instructions, v.model, v.skill_tags, v.version FROM agents a
                    LEFT JOIN agent_versions v ON v.id = a.current_version_id WHERE a.slug=%s""", (slug,))


def instructions(slug: str) -> str:
    a = agent(slug)
    return (a or {}).get("instructions") or ""


# ---------- planning ----------

DOMAIN_KEYWORDS = {
    "materials": ["crystal", "pymatgen", "materials project", "formation energy", "lattice", "matbench", "cgcnn"],
    "graphs": ["graph neural", "message passing", "gnn", "node classification"],
    "3d": ["point cloud", "pointnet", "nerf", "mesh", "voxel", "signed distance"],
    "physics_informed": ["pde", "physics-informed", "burgers", "navier"],
    "tabular": ["tabular", "xgboost", "gradient boosted", "tabpfn"],
}


def detect_domain(text: str) -> str | None:
    t = text.lower()
    best, hits = None, 0
    for dom, kws in DOMAIN_KEYWORDS.items():
        n = sum(1 for k in kws if k in t)
        if n > hits:
            best, hits = dom, n
    return best if hits >= 2 else None


@dataclass
class Plan:
    skills: list[str]
    assignments: dict[str, str]  # skill -> agent slug
    created: list[str] = field(default_factory=list)
    reasons: dict[str, str] = field(default_factory=dict)


BASE_SKILLS = ["read_paper", "extract_claims", "find_sources", "write_code", "review_code", "debug_code",
               "design_tests", "run_tests", "compare_claims", "draw_map"]


def plan(run_id: int, summary: str, note: str, budget: str, dataset_hint: dict) -> Plan:
    """Make the skills list, match each skill to an agent, create specialists for missing skills."""
    seed()
    skills = list(BASE_SKILLS)
    reasons: dict[str, str] = {}

    if budget in ("quick", "standard") and (dataset_hint.get("large") or "laptop" in note.lower()):
        skills.append("data_budgeting")
        reasons["data_budgeting"] = (f"the full dataset needs about {dataset_hint.get('full_minutes', 'many')} minutes on this "
                                     f"laptop but the '{budget}' budget allows about {BUDGET_MINUTES[budget]}, and no current "
                                     "agent handles data budgeting")
    if dataset_hint.get("missing_settings"):
        skills.append("hyperparameter_choice")
        reasons["hyperparameter_choice"] = ("the paper does not state " + ", ".join(dataset_hint["missing_settings"][:3]))
    domain = detect_domain(summary + " " + note)
    if domain:
        skills.append(f"domain:{domain}")
        reasons[f"domain:{domain}"] = f"this paper is in the {domain.replace('_', ' ')} field and no agent has handled it before"

    # Optional extra skills suggested by the planner model.
    extra, tokens = llm.chat_json("planner",
        "You are the Team Manager of an ML research reproduction lab. Given a paper summary, list up to 3 extra "
        "specialised skills (snake_case) beyond reading the paper, writing/debugging code and testing that this paper needs. "
        'Only include skills that clearly matter. JSON: {"skills": [{"name": "...", "reason": "..."}]}',
        f"Summary:\n{summary[:3000]}\n\nResearcher note: {note}\nBudget: {budget}") if llm.available() else (None, 0)
    if isinstance(extra, dict):
        for s in (extra.get("skills") or [])[:3]:
            name = re.sub(r"[^a-z0-9_:]", "_", str(s.get("name", "")).lower()).strip("_")
            if name and name not in skills and name in {"data_budgeting", "hyperparameter_choice", "fix_environment"}:
                skills.append(name)
                reasons[name] = str(s.get("reason", ""))[:200]

    p = Plan(skills=skills, assignments={}, reasons=reasons)
    bus.emit(run_id, "manager", "skills_list", "Skills needed: " + ", ".join(skills),
             "Made from a quick summary of the paper and the researcher's note", {"skills": skills})
    for skill in skills:
        slug = assign(run_id, skill, reasons.get(skill, ""))
        p.assignments[skill] = slug
    return p


BUDGET_MINUTES = {"quick": 5, "standard": 15, "deep": 60}
TEMPLATE_FOR_SKILL = {"data_budgeting": "dataset_subset_planner", "hyperparameter_choice": "hyperparameter_scout",
                      "fix_environment": "environment_fixer", "explain_gap": "gap_detective"}


def candidates(skill: str) -> list[dict]:
    return db.q("""
        SELECT a.id, a.slug, a.stage, a.avg_score, a.tasks_count,
               (SELECT avg(score) FROM agent_tasks t WHERE t.agent_id=a.id AND t.skill=%s AND t.score IS NOT NULL) AS skill_score,
               (SELECT count(*) FROM agent_tasks t WHERE t.agent_id=a.id AND t.skill=%s) AS skill_tasks
        FROM agents a JOIN agent_versions v ON v.id = a.current_version_id
        WHERE %s = ANY(v.skill_tags) AND a.stage NOT IN ('retired', 'merged', 'replaced')""", (skill, skill, skill))


def assign(run_id: int, skill: str, reason: str = "") -> str:
    """Pick the agent for a skill: best past score for that skill, sometimes a newer agent (exploration)."""
    cands = candidates(skill)
    if not cands:
        return create_specialist(run_id, skill, reason)
    for c in cands:
        c["est"] = float(c["skill_score"]) if c["skill_score"] is not None else 0.5
    cands.sort(key=lambda c: c["est"], reverse=True)
    chosen = cands[0]
    why = f"best past score for '{skill}' ({chosen['est']:.2f} over {chosen['skill_tasks']} tasks)"
    trial = [c for c in cands[1:] if c["stage"] == "trial"]
    if trial and random.random() < 0.15:
        chosen = trial[0]
        why = f"trying newer agent for '{skill}' so the team does not get stuck with the same choice"
    if len(cands) > 1 or chosen["stage"] == "trial":
        decide(run_id, "assign", [chosen["id"]], skill, f"Assigned {chosen['slug']} to {skill}: {why}")
    return chosen["slug"]


def create_specialist(run_id: int, skill: str, reason: str = "") -> str:
    if skill.startswith("domain:"):
        domain = skill.split(":", 1)[1]
        tmpl = "domain_specialist"
        name = f"Domain Specialist ({domain.replace('_', ' ')})"
        slug_base = f"specialist.domain_{domain}"
        role = "planner"
        instr = SPECIALIST_TEMPLATES[tmpl][3] + f" Field: {domain}."
        if llm.available():
            res = llm.chat("planner", "Write concise instructions (max 120 words) for a domain specialist agent that advises "
                           "a code writer reproducing an ML paper. Mention key libraries and pitfalls.", f"Field: {domain}")
            if res and res.text:
                instr = res.text.strip()[:1500]
    else:
        tmpl = TEMPLATE_FOR_SKILL.get(skill)
        if not tmpl:
            tmpl = "hyperparameter_scout" if "param" in skill else "environment_fixer"
        name, role, _, instr = SPECIALIST_TEMPLATES[tmpl]
        slug_base = f"specialist.{tmpl}"
    n = db.scalar("SELECT count(*) FROM agents WHERE slug LIKE %s", (slug_base + ".v%",)) or 0
    slug = f"{slug_base}.v{n + 1}"
    why = f"Created '{name}' because {reason}" if reason else f"Created '{name}' because no current agent has the skill '{skill}'"
    _create_agent(slug, name, "specialist", "", tmpl, "trial", instr, role, [skill], why, run_id)
    bus.emit(run_id, "manager", "agent_created", why, "The team is not fixed: specialists are created when a skill is missing",
             {"agent": slug, "skill": skill, "map_nodes": [node(f"agent:{slug}", "agent", name, "waiting")]})
    return slug


# ---------- tasks and the reward loop ----------

@dataclass
class Task:
    run_id: int
    slug: str
    skill: str
    tokens: list[int] = field(default_factory=lambda: [0])
    sandbox_seconds: float = 0.0
    wasted_tries: int = 0
    outcome: float = 0.0
    notes: str = ""
    task_id: int | None = None


@contextmanager
def task(run_id: int, slug: str, skill: str, message: str, why: str = ""):
    """Run one agent task: emits start/finish events, tracks tokens and sandbox time, then scores it."""
    bus.check_control(run_id)
    a = agent(slug)
    if a is None:
        seed()
        a = agent(slug)
    t = Task(run_id=run_id, slug=slug, skill=skill)
    tok = llm.current_tokens.set(t.tokens)
    bus.emit(run_id, slug, "agent_started", message, why, {"skill": skill})
    started = time.time()
    failed = None
    try:
        yield t
    except bus.RunStopped:
        failed = "stopped"
        raise
    except Exception as e:  # noqa: BLE001
        failed = str(e)
        t.outcome = 0.0
        t.notes = (t.notes + f" Failed: {e}").strip()
        raise
    finally:
        llm.current_tokens.reset(tok)
        t.task_id = db.scalar(
            """INSERT INTO agent_tasks (run_id, agent_id, skill, outcome, tokens, sandbox_seconds, wasted_tries, notes)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (run_id, a["id"], skill, t.outcome, t.tokens[0], round(t.sandbox_seconds, 1), t.wasted_tries, t.notes[:2000]))
        score = score_task(t.task_id)
        typ = "agent_failed" if failed and failed != "stopped" else "agent_finished"
        bus.emit(run_id, slug, typ,
                 f"{a['name']} finished '{skill}' (score {score:.2f})" if typ == "agent_finished" else f"{a['name']} failed: {failed}"[:300],
                 t.notes[:300],
                 {"skill": skill, "task_id": t.task_id, "score": score},
                 {"tokens": t.tokens[0], "sandbox_seconds": round(t.sandbox_seconds, 1),
                  "seconds": round(time.time() - started, 1)})


def score_task(task_id: int) -> float:
    """score = 0.5*outcome + 0.2*feedback - 0.2*cost - 0.1*wasted, rescaled to 0..1 (max raw is 0.7)."""
    t = db.q1("SELECT * FROM agent_tasks WHERE id=%s", (task_id,))
    if not t:
        return 0.0
    avg = db.q1("""SELECT avg(tokens) AS tok, avg(sandbox_seconds) AS sec FROM agent_tasks
                   WHERE skill=%s AND id <> %s""", (t["skill"], task_id)) or {}
    avg_tok = max(float(avg.get("tok") or 2000), 200.0)
    avg_sec = max(float(avg.get("sec") or 60), 10.0)
    cost_ratio = 0.5 * (t["tokens"] / avg_tok) + 0.5 * (float(t["sandbox_seconds"]) / avg_sec)
    cost = min(cost_ratio, 2.0) / 2.0
    fb = t["feedback"]
    feedback = 0.5 if fb is None else (1.0 if fb > 0 else 0.0)
    wasted = min(t["wasted_tries"] / 5.0, 1.0)
    outcome = float(t["outcome"] or 0)
    raw = 0.5 * outcome + 0.2 * feedback - 0.2 * cost - 0.1 * wasted
    score = max(0.0, min(1.0, raw / 0.7))
    db.ex("UPDATE agent_tasks SET score=%s WHERE id=%s", (round(score, 4), task_id))
    db.ex("""UPDATE agents SET avg_score = COALESCE((SELECT avg(score) FROM agent_tasks WHERE agent_id=%s AND score IS NOT NULL), 0),
                               tasks_count = (SELECT count(*) FROM agent_tasks WHERE agent_id=%s)
             WHERE id=%s""", (t["agent_id"], t["agent_id"], t["agent_id"]))
    return score


def rescore(task_id: int) -> None:
    score_task(task_id)
    t = db.q1("SELECT run_id FROM agent_tasks WHERE id=%s", (task_id,))
    if t:
        evolve(t["run_id"])


# ---------- evolution ----------

def evolve(run_id: int | None) -> None:
    """Apply the life-cycle rules of Section 9.2 to every agent."""
    agents_ = db.q("""SELECT a.*, v.instructions, v.skill_tags, v.model, v.version FROM agents a
                      JOIN agent_versions v ON v.id = a.current_version_id
                      WHERE a.stage NOT IN ('retired','merged','replaced') AND a.kind <> 'manager'""")
    for a in agents_:
        scores = [r["score"] for r in db.q(
            "SELECT score FROM agent_tasks WHERE agent_id=%s AND score IS NOT NULL ORDER BY id DESC LIMIT 6", (a["id"],))]
        if not scores:
            continue
        n = a["tasks_count"]
        avg = float(a["avg_score"])
        last3 = scores[:3]
        low3 = len(last3) == 3 and all(s < 0.4 for s in last3)
        if a["stage"] == "trial" and n >= 3 and avg >= 0.6:
            _set_stage(a, "active")
            decide(run_id, "promote", [a["id"]], (a["skill_tags"] or [""])[0],
                   f"Promoted {a['slug']} to active: average score {avg:.2f} after {n} tasks")
        elif low3 and a["stage"] == "refined":
            refined_at = db.scalar("SELECT max(created_at) FROM team_decisions WHERE %s = ANY(agent_ids) AND decision='refine'", (a["id"],))
            after = db.scalar("SELECT count(*) FROM agent_tasks WHERE agent_id=%s AND created_at > %s", (a["id"], refined_at)) if refined_at else 3
            if after >= 3 and a["kind"] == "specialist":
                _set_stage(a, "retired")
                decide(run_id, "retire", [a["id"]], (a["skill_tags"] or [""])[0],
                       f"Retired '{a['name']}' ({a['slug']}): still below 0.4 after being refined "
                       f"(average {avg:.2f} over {n} tasks); recipe and history kept in the archive")
        elif low3 and a["stage"] in ("trial", "active"):
            refine(run_id, a)
    _merge_and_replace(run_id)


def _set_stage(a: dict, stage: str) -> None:
    db.ex("UPDATE agents SET stage=%s WHERE id=%s", (stage, a["id"]))


def refine(run_id, a: dict) -> None:
    notes = [r["notes"] for r in db.q(
        "SELECT notes FROM agent_tasks WHERE agent_id=%s AND notes <> '' ORDER BY id DESC LIMIT 5", (a["id"],))]
    new_instr = a["instructions"]
    res = llm.chat("planner", "Rewrite this AI agent's instructions to avoid its recent failures. Keep it under 200 words.",
                   f"Current instructions:\n{a['instructions']}\n\nFailure notes:\n" + "\n".join(notes)) if llm.available() else None
    if res and res.text:
        new_instr = res.text.strip()[:3000]
    else:
        new_instr = a["instructions"] + "\nLessons from failures: " + " | ".join(n[:150] for n in notes)
    with db.pool.connection() as c, c.transaction():
        vid = c.execute("""INSERT INTO agent_versions (agent_id, version, instructions, tools, model, skill_tags, created_reason)
                           SELECT agent_id, version + 1, %s, tools, model, skill_tags, %s FROM agent_versions WHERE id=%s
                           RETURNING id""", (new_instr, "Refined after 3 low scores", a["current_version_id"])).fetchone()["id"]
        c.execute("UPDATE agents SET current_version_id=%s, stage='refined' WHERE id=%s", (vid, a["id"]))
    decide(run_id, "refine", [a["id"]], (a["skill_tags"] or [""])[0],
           f"Refined {a['slug']}: score below 0.4 on 3 tasks in a row; instructions rewritten from its own failure notes")


def _merge_and_replace(run_id) -> None:
    specs = db.q("""SELECT a.*, v.skill_tags, v.instructions FROM agents a JOIN agent_versions v ON v.id=a.current_version_id
                    WHERE a.kind='specialist' AND a.stage NOT IN ('retired','merged','replaced') ORDER BY a.id""")
    for i, a in enumerate(specs):
        for b in specs[i + 1:]:
            sa, sb = set(a["skill_tags"] or []), set(b["skill_tags"] or [])
            if not sa or not sb:
                continue
            jacc = len(sa & sb) / len(sa | sb)
            if jacc < 0.8 or a["template"] != b["template"]:
                continue
            if a["tasks_count"] >= 3 and b["tasks_count"] >= 3:
                cost = lambda x: db.scalar("SELECT avg(tokens + sandbox_seconds*50) FROM agent_tasks WHERE agent_id=%s", (x["id"],)) or 0  # noqa: E731
                better, worse = (b, a) if float(b["avg_score"]) > float(a["avg_score"]) else (a, b)
                if float(better["avg_score"]) > float(worse["avg_score"]) + 0.1 and cost(better) <= cost(worse):
                    _set_stage(worse, "replaced")
                    decide(run_id, "replace", [better["id"], worse["id"]], next(iter(sa & sb)),
                           f"{better['slug']} replaced {worse['slug']}: higher score ({float(better['avg_score']):.2f} vs "
                           f"{float(worse['avg_score']):.2f}) at lower cost")
                    return
            keep, drop = (a, b) if float(a["avg_score"]) >= float(b["avg_score"]) else (b, a)
            _set_stage(drop, "merged")
            decide(run_id, "merge", [keep["id"], drop["id"]], next(iter(sa & sb)),
                   f"Merged {drop['slug']} into {keep['slug']}: they do the same job (skill overlap {jacc:.0%}), one agent costs less")
            return
