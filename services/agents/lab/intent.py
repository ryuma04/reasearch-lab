"""Team Manager understanding a researcher's command (typed, or voice transcribed by Whisper),
plus a plain status summary. Used by the Telegram bot and the mobile voice button."""
from __future__ import annotations

import re

from . import db, llm
from .project import fmt

ACTIONS = ["status", "approve", "reject", "edit", "whatif", "pause", "resume", "stop", "retry", "push", "instruct", "help"]


def understand(text: str, runs: list[dict]) -> dict:
    t = text.strip()
    out = {"action": "unknown", "run_id": 0, "checkpoint": "", "question": "", "instruction": "", "reply": "", "needs_confirm": False}
    m = re.search(r"(?:run\s*#?\s*)(\d+)", t, flags=re.I)
    if m:
        out["run_id"] = int(m.group(1))
    elif runs:
        out["run_id"] = runs[0]["id"]

    if llm.available():
        data, _ = llm.chat_json("fast", "You control an AI research lab. Classify the researcher's message. Actions: "
                                + ", ".join(ACTIONS) + ". 'whatif' = start a new experiment branch (put the question in "
                                "'question'); 'edit' = change the plan at a checkpoint (put it in 'instruction'); 'instruct' = "
                                "give the agents an instruction. JSON: {action, run_id, checkpoint, question, instruction}",
                                f"Runs: {runs}\nMessage: {t}", max_tokens=300)
        if isinstance(data, dict) and data.get("action") in ACTIONS:
            for k in ("action", "checkpoint", "question", "instruction"):
                if data.get(k):
                    out[k] = str(data[k])
            if str(data.get("run_id", "")).isdigit() and int(data["run_id"]) > 0:
                out["run_id"] = int(data["run_id"])
            out["needs_confirm"] = out["action"] not in ("status", "help", "unknown")
            return out

    low = t.lower()
    rules = [
        (r"\b(how|status|progress|going|update)\b", "status"),
        (r"\b(what if|try|branch)\b", "whatif"),
        (r"\b(approve|yes|go ahead|looks good|ok)\b", "approve"),
        (r"\b(reject|no\b|cancel plan)", "reject"),
        (r"\bpause\b", "pause"), (r"\bresume|continue\b", "resume"), (r"\bstop\b", "stop"), (r"\bretry\b", "retry"),
        (r"\bpush|github\b", "push"), (r"\bhelp\b", "help"),
    ]
    for pat, action in rules:
        if re.search(pat, low):
            out["action"] = action
            break
    if out["action"] == "whatif":
        q = re.sub(r"^\s*(please\s+)?", "", t)
        out["question"] = q if q.lower().startswith("what if") else f"What if we {q[0].lower() + q[1:]}"
    if out["action"] in ("approve", "reject"):
        pend = next((r for r in runs if r.get("id") == out["run_id"] and r.get("pending_checkpoint")), None)
        out["checkpoint"] = pend["pending_checkpoint"] if pend else ""
    out["needs_confirm"] = out["action"] not in ("status", "help", "unknown")
    if out["action"] == "unknown":
        out["reply"] = ("I can report status, approve or reject a checkpoint, start a what-if (\"try temperature 5\"), "
                        "pause, resume, stop or retry a run, and push results to GitHub.")
    return out


def summary(run_id: int) -> str:
    r = db.q1("SELECT r.*, w.title FROM runs r JOIN workspaces w ON w.id=r.workspace_id WHERE r.id=%s", (run_id,))
    if not r:
        return "Run not found."
    parts = [f"Run #{run_id} ({r['title']}) is {r['status'].replace('_', ' ')}, stage: {r['stage'].replace('_', ' ')}."]
    last = db.q1("SELECT agent, message FROM run_events WHERE run_id=%s AND type IN ('agent_started','progress','claim_scored','results_ready') "
                 "ORDER BY id DESC LIMIT 1", (run_id,))
    if last:
        parts.append(f"Latest: {last['message']}")
    sc = db.q("SELECT status, count(*) AS n FROM scorecard_entries WHERE run_id=%s GROUP BY status", (run_id,))
    if sc:
        c = {x["status"]: x["n"] for x in sc}
        parts.append(f"Scorecard: {c.get('match', 0)} match, {c.get('close', 0)} close, {c.get('different', 0)} different.")
    pend = db.q1("SELECT name FROM checkpoints WHERE run_id=%s AND status='pending'", (run_id,))
    if pend:
        parts.append(f"Waiting for your approval: {pend['name']}.")
    best = db.q1("""SELECT b.label, m.name, m.value FROM whatif_branches b JOIN metrics m ON m.id=b.result_metric_id
                    WHERE b.run_id=%s AND b.reason='best branch' ORDER BY b.id DESC LIMIT 1""", (run_id,))
    if best:
        parts.append(f"Best what-if branch: {best['label']} ({best['name']} = {fmt(best['value'])}).")
    return " ".join(parts)
