"""Versioned change requests: analyze a natural-language request, create an isolated new version, and apply the change.

A version is a new run linked to the run it came from. It gets its own copy of the code (never the source's folder),
so nothing a version does can reach the original; the source tree is hashed before and after the copy to prove it.
The change itself is made by an AI model through validated whole-file edits (allowed paths only, Python must
compile); if no model is available the version fails honestly instead of pretending to have changed anything.
"""
from __future__ import annotations

import hashlib
import json
import logging
import shutil

from . import bus, db, llm
from .project import COPY_IGNORE, load_settings, pdir, record_settings, remove_tree, safe_rel, write_files

log = logging.getLogger("lab.change")

ANALYZER_SYSTEM = (
    "You are the Change-Request Analyzer of an ML research lab. A researcher asks, in plain English, for a change to a completed "
    "implementation. Decide what that means. Never drop a requirement the researcher did not ask to change. Return JSON: "
    "{intent, unchanged:[string], modified:[string], added:[string], removed:[string], affected_modules:[file paths from the given list], "
    "research:{still_valid:[string], needs_verification:[string], superseded:[string], needs_new_research:boolean, topics:[string]}, "
    "tests_to_add_or_rerun:[string], risks:[string], assumptions:[string], ambiguity:string (empty unless the request could mean "
    "something destructive or expensive), clarifying_question:string}."
)
EDIT_SYSTEM = (
    "You are the Coding Agent. Apply the researcher's change to the project by returning COMPLETE new contents for each file you change. "
    "Change only what the request needs; keep everything else working; keep results/metrics.json written by the code. Return JSON: "
    '{"summary": string, "edits": [{"path": "src/train.py", "content": "<full file>"}]}. Allowed paths: src/, configs/, tests/, requirements.txt.'
)
MAX_CONTEXT = 60_000


class ChangeFailed(Exception):
    """The change could not be applied; the message is shown to the researcher."""


def for_run(run_id: int) -> dict | None:
    return db.q1("SELECT * FROM change_requests WHERE new_run_id=%s", (run_id,))


def tree_digest(root) -> str:
    """Fingerprint of a version's code files (path + content), used to prove the source version was not modified."""
    h = hashlib.sha256()
    if not root.exists():
        return "missing"
    for p in sorted(root.rglob("*")):
        if p.is_symlink() or not p.is_file() or any(x in p.parts for x in ("__pycache__", "logs", "results", "models", ".git")):
            continue
        h.update(p.relative_to(root).as_posix().encode())
        h.update(p.read_bytes())
    return h.hexdigest()[:16]


def code_listing(root) -> dict[str, str]:
    out, total = {}, 0
    for pat in ("src/**/*.py", "tests/**/*.py", "configs/*", "requirements.txt"):
        for p in sorted(root.glob(pat)):
            if p.is_file() and not p.is_symlink() and "__pycache__" not in p.parts:
                text = p.read_text(encoding="utf-8", errors="replace")
                total += len(text)
                if total > MAX_CONTEXT:
                    return out
                out[p.relative_to(root).as_posix()] = text
    return out


def _plan_tasks(run_id: int) -> list[dict]:
    f = pdir(run_id) / "research" / "plan_review.json"
    if not f.exists():
        return []
    try:
        rv = json.loads(f.read_text(encoding="utf-8"))
    except ValueError:
        return []
    block = rv.get(rv.get("ready") or "initial") or {}
    return ((block.get("plan") or {}).get("tasks")) or []


# ---------- analysis ----------

def fallback_analysis(text: str, files: list[str]) -> dict:
    """Used only when no AI provider answers; it says so and does not guess which modules are affected."""
    return {"intent": text.strip(), "unchanged": ["Every requirement and result of the source version that you did not mention"],
            "modified": [], "added": [], "removed": [], "affected_modules": files,
            "research": {"still_valid": ["All research findings of the source version"], "needs_verification": [], "superseded": [],
                         "needs_new_research": False, "topics": []},
            "tests_to_add_or_rerun": ["Re-run the full test suite of the source version against the changed code"],
            "risks": ["The request could not be analysed by an AI model, so affected modules are unknown and all code files are listed"],
            "assumptions": ["No AI provider answered: this analysis is a placeholder, not a model judgement"], "ambiguity": "", "clarifying_question": "",
            "source": "fallback"}


def analyze(text: str, ctx: dict) -> dict:
    files = ctx["files"]
    data, _ = llm.chat_json("planner", ANALYZER_SYSTEM, json.dumps(ctx, default=str)[:30_000] + "\n\nChange request: " + text, max_tokens=3000, agent="change_analyzer")
    if isinstance(data, dict) and data.get("intent"):
        data["affected_modules"] = [m for m in data.get("affected_modules", []) if m in files] or files
        data.setdefault("research", {})
        data["source"] = "ai"
        return data
    return fallback_analysis(text, files)


# ---------- version creation ----------

def start_version(run_id: int, ch: dict) -> None:
    """Analyze the request, then give the new run its own copy of the source version's code and settings."""
    src_id, text = ch["source_run_id"], ch["request_text"]
    src, dst = pdir(src_id), pdir(run_id)
    bus.emit(run_id, "change.analyzer", "agent_started", "Analyzing your change request", "The analyzer decides what changes, what stays and what must be re-researched")
    before = tree_digest(src)
    remove_tree(dst)
    shutil.copytree(src, dst, ignore=COPY_IGNORE, symlinks=True)  # symlinks stay links: nothing outside the version is followed
    for s in load_settings(src_id):
        record_settings(run_id, [s])
    after = tree_digest(src)
    brief = {}
    bf = dst / "research" / "brief.json"
    if bf.exists():
        try:
            brief = json.loads(bf.read_text(encoding="utf-8"))
        except ValueError:
            pass
    files = list(code_listing(dst))
    ctx = {"source_run_id": src_id, "files": files, "papers": [{k: p.get(k) for k in ("title", "summary", "claims")} for p in brief.get("papers", [])],
           "plan_tasks": [t.get("title") for t in _plan_tasks(src_id)],
           "settings": [{s["name"]: s["value"]} for s in load_settings(src_id)][:30],
           "previous_changes": [c["request_text"] for c in db.q("SELECT request_text FROM change_requests WHERE workspace_id=%s AND id<>%s ORDER BY id", (ch["workspace_id"], ch["id"]))]}
    analysis = analyze(text, ctx)
    analysis["isolation"] = {"source_run_id": src_id, "source_digest_before": before, "source_digest_after": after, "source_unchanged": before == after,
                             "files_copied": len(files)}
    db.ex("UPDATE change_requests SET analysis=%s, status='analyzed', updated_at=now() WHERE id=%s", (db.J(analysis), ch["id"]))
    bus.emit(run_id, "change.analyzer", "agent_finished", "Change analysis ready: " + (analysis.get("intent") or text)[:160],
             "Done by " + ("an AI model" if analysis["source"] == "ai" else "the fallback (no AI answered)"),
             {"analysis_source": analysis["source"], "ambiguity": analysis.get("ambiguity", "")})
    bus.emit(run_id, "system", "version_created",
             f"New version created from run #{src_id} with its own copy of the code ({len(files)} files)",
             "The source version's code is unchanged" if before == after else "WARNING: the source digest changed while copying",
             {"source_run_id": src_id, "source_unchanged": before == after})
    if analysis.get("ambiguity"):
        bus.emit(run_id, "change.analyzer", "clarification", "Your request is ambiguous: " + analysis["ambiguity"][:200],
                 "Review the plan carefully; reject it and submit a clearer request if the plan is not what you meant",
                 {"question": analysis.get("clarifying_question", "")})


def targeted_research(run_id: int, ch: dict) -> None:
    """Reuse the source's research; only search again when the analysis says the change needs new evidence."""
    analysis = ch.get("analysis") or {}
    if isinstance(analysis, str):
        analysis = json.loads(analysis)
    r = analysis.get("research") or {}
    if not r.get("needs_new_research"):
        bus.emit(run_id, "research.paper_reader", "research_reused",
                 f"Reusing the research of run #{ch['source_run_id']}: the change does not need new evidence",
                 "Only research that the change makes stale or missing is repeated", {"still_valid": r.get("still_valid", [])})
        return
    from . import resources, sources as cs
    f = cs.Fetch()
    topics = [t for t in (r.get("topics") or []) if t][:3] or [ch["request_text"][:80]]
    found = []
    for t in topics:
        for c in cs.discover(f, t, ""):
            found.append({"topic": t, "name": c.get("name"), "url": c.get("url"), "host": c.get("host"), "description": (c.get("description") or "")[:200]})
        cands, _ = resources.discover_datasets(f, resources.objective_terms(t, 4), t)
        found += [{"topic": t, "name": c["name"], "url": c["url"], "host": c["host"], "description": (c.get("description") or "")[:200]} for c in cands[:3]]
    seen, uniq = set(), []
    for x in found:
        if x["url"] not in seen:
            seen.add(x["url"])
            uniq.append(x)
    out = {"topics": topics, "results": uniq, "failed": bool(f.limits and not uniq), "limitations": sorted(set(f.limits))}
    bf = pdir(run_id) / "research" / "brief.json"
    if bf.exists():
        brief = json.loads(bf.read_text(encoding="utf-8"))
        brief.setdefault("sources", {})["change_research"] = out
        bf.write_text(json.dumps(brief, indent=2, default=str), encoding="utf-8")
    bus.emit(run_id, "research.source_finder", "research_updated",
             f"Targeted research on {len(topics)} topic(s): {len(uniq)} source(s) found" + (" (search failed)" if out["failed"] else ""),
             "Findings are stored with this version only", {"topics": topics})


# ---------- applying the change ----------

def plan_note(run_id: int) -> str:
    ch = for_run(run_id)
    if not ch:
        return ""
    a = ch.get("analysis") or {}
    if isinstance(a, str):
        a = json.loads(a)
    return (f"Change request for this version: {ch['request_text']}\nIntent: {a.get('intent', '')}\nModify: {a.get('modified', [])}\n"
            f"Add: {a.get('added', [])}\nRemove: {a.get('removed', [])}\nKeep unchanged: {a.get('unchanged', [])}\nTests: {a.get('tests_to_add_or_rerun', [])}")


def validate_edits(root, edits) -> tuple[dict[str, str], list[str]]:
    """Keep only edits to allowed paths whose Python compiles; the second value lists what was refused and why."""
    ok, refused = {}, []
    for e in edits if isinstance(edits, list) else []:
        if not isinstance(e, dict) or not isinstance(e.get("content"), str):
            refused.append("an edit without file content")
            continue
        rel = safe_rel(e.get("path", ""), editable_only=True)
        if not rel:
            refused.append(f"{e.get('path')}: path not allowed")
            continue
        if rel.endswith(".py"):
            try:
                compile(e["content"], rel, "exec")
            except SyntaxError as exc:
                refused.append(f"{rel}: does not compile ({exc.msg}, line {exc.lineno})")
                continue
        ok[rel] = e["content"]
    return ok, refused


def apply_changes(run_id: int) -> list[str]:
    """Edit this version's own copy of the code to implement the change. Raises ChangeFailed with an actionable message."""
    ch = for_run(run_id)
    if not ch:
        raise ChangeFailed("This run has no change request")
    root = pdir(run_id)
    before = code_listing(root)
    plan = [{"id": t.get("id"), "title": t.get("title"), "description": t.get("description")} for t in _plan_tasks(run_id)]
    user = json.dumps({"change_request": ch["request_text"], "analysis": ch.get("analysis"), "approved_plan": plan, "files": before}, default=str)
    bus.emit(run_id, "coding.writer", "agent_started", "Applying your change to this version's code", "Only this version's own copy is edited")
    data, _ = llm.invoke_json("coding", EDIT_SYSTEM, user, max_tokens=8000)
    if not isinstance(data, dict):
        raise ChangeFailed("The coding model (Arina) produced no change: " + (llm.last_error() or "it is not configured") + ". No code was changed. Check the provider settings and retry.")
    edits, refused = validate_edits(root, data.get("edits"))
    changed = [p for p, c in edits.items() if before.get(p) != c]
    if not changed:
        raise ChangeFailed("The AI did not produce a usable change" + (": " + "; ".join(refused[:3]) if refused else "") + ". No code was changed.")
    written = write_files(root, {p: edits[p] for p in changed}, editable_only=True)
    if "requirements.txt" in written:
        (root / ".needs_install").write_text("1")
    bus.emit(run_id, "coding.writer", "files_written", f"Changed {len(written)} file(s): " + ", ".join(written),
             (data.get("summary") or "")[:300], {"files": written, "refused": refused})
    return written
