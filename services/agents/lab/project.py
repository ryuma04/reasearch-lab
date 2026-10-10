"""Helpers for a run's project folder: files, the labelled config, settings records,
fix operations and child runs (what-if branches and gap experiments)."""
from __future__ import annotations

import json
import os
import re
import shutil
import stat
from pathlib import Path

from . import db
from .config import project_dir


def run_row(run_id: int) -> dict:
    r = db.q1("SELECT * FROM runs WHERE id=%s", (run_id,))
    if not r:
        raise ValueError(f"run {run_id} not found")
    return r


def pdir(run_id: int) -> Path:
    r = run_row(run_id)
    p = project_dir(r["workspace_id"], run_id)
    p.mkdir(parents=True, exist_ok=True)
    return p


def write_files(root: Path, files: dict[str, str]) -> list[str]:
    written = []
    for rel, content in files.items():
        rel = rel.replace("\\", "/").lstrip("/")
        if ".." in Path(rel).parts:
            continue
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8", newline="\n")
        written.append(rel)
    return written


# ---------- settings and config ----------

SOURCE_LABEL = {"paper": "from the paper", "official_code": "from the official code", "assumption": "our assumption",
                "compute_change": "changed to fit compute", "researcher": "set by the researcher"}


def record_settings(run_id: int, items: list[dict]) -> None:
    for s in items:
        db.ex("""INSERT INTO settings (run_id, name, value, source, source_ref, reason, paper_value)
                 VALUES (%s,%s,%s,%s,%s,%s,%s)
                 ON CONFLICT (run_id, name) DO UPDATE SET value=EXCLUDED.value, source=EXCLUDED.source,
                     source_ref=EXCLUDED.source_ref, reason=EXCLUDED.reason, paper_value=EXCLUDED.paper_value""",
              (run_id, s["name"], str(s["value"]), s.get("source", "assumption"), s.get("source_ref", ""),
               s.get("reason", ""), str(s.get("paper_value", ""))))


def load_settings(run_id: int) -> list[dict]:
    return db.q("SELECT name, value, source, source_ref, reason, paper_value FROM settings WHERE run_id=%s ORDER BY name", (run_id,))


def _typed(v: str):
    if isinstance(v, (int, float, bool, list, dict)):
        return v
    s = str(v).strip()
    if s[:1] in "[{":
        try:
            return json.loads(s)
        except ValueError:
            pass
    if s.lower() in ("true", "false"):
        return s.lower() == "true"
    try:
        return int(s)
    except ValueError:
        pass
    try:
        return float(s)
    except ValueError:
        return s


def _yaml_scalar(v) -> str:
    if isinstance(v, (list, dict)):
        return json.dumps(v)  # JSON flow style is valid YAML
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    s = str(v)
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.\-]*", s) and s.lower() not in ("true", "false", "null", "yes", "no"):
        return s
    return json.dumps(s)


def write_config(root: Path, settings: list[dict]) -> str:
    """configs/config.yaml with every setting and a comment saying where it came from (Hero 4)."""
    tree: dict = {}
    notes: dict[str, str] = {}
    for s in settings:
        parts = s["name"].split(".")
        cur = tree
        for p in parts[:-1]:
            cur = cur.setdefault(p, {})
        cur[parts[-1]] = _typed(s["value"])
        label = SOURCE_LABEL.get(s["source"], s["source"])
        ref = f" ({s['source_ref']})" if s.get("source_ref") else ""
        note = f"{label}{ref}"
        if s.get("reason"):
            note += f": {s['reason']}"
        if s.get("paper_value"):
            note += f" [paper: {s['paper_value']}]"
        notes[s["name"]] = note

    lines = ["# Every setting, labelled with its source: paper / official code / our assumption / changed to fit compute."]

    def emit(d: dict, prefix: str, indent: int):
        for k, v in d.items():
            name = f"{prefix}{k}"
            if isinstance(v, dict):
                lines.append(" " * indent + f"{k}:")
                emit(v, name + ".", indent + 2)
            else:
                lines.append(" " * indent + f"{k}: {_yaml_scalar(v)}  # {notes.get(name, '')}")

    emit(tree, "", 0)
    text = "\n".join(lines) + "\n"
    (root / "configs").mkdir(parents=True, exist_ok=True)
    (root / "configs" / "config.yaml").write_text(text, encoding="utf-8", newline="\n")
    return text


def set_config_values(run_id: int, changes: dict, source: str, reason: str) -> None:
    """Change settings of a run (e.g. a what-if branch) and rewrite its config."""
    current = {s["name"]: s for s in load_settings(run_id)}
    items = []
    for k, v in changes.items():
        prev = current.get(k, {})
        items.append({"name": k, "value": v, "source": source, "source_ref": "", "reason": reason,
                      "paper_value": prev.get("paper_value", "")})
    record_settings(run_id, items)
    write_config(pdir(run_id), load_settings(run_id))


# ---------- fix operations (Debugger, Environment Fixer, Lab Memory) ----------

def apply_ops(run_id: int, ops: list[dict]) -> tuple[list[str], bool]:
    """Apply fix ops; returns (descriptions, needs_reinstall)."""
    root = pdir(run_id)
    done, reinstall = [], False
    for op in ops:
        kind = op.get("op")
        if kind == "add_requirement":
            req = root / "requirements.txt"
            lines = req.read_text().splitlines() if req.exists() else []
            name = re.split(r"[<>=!~\[ ]", op["value"], maxsplit=1)[0].lower()
            lines = [l for l in lines if re.split(r"[<>=!~\[ ]", l, maxsplit=1)[0].lower() != name]
            lines.append(op["value"])
            req.write_text("\n".join(lines) + "\n")
            done.append(f"pinned {op['value']}")
            reinstall = True
        elif kind == "remove_pins":
            req = root / "requirements.txt"
            if req.exists():
                lines = [re.split(r"[<>=!~]", l, maxsplit=1)[0].strip() for l in req.read_text().splitlines() if l.strip()]
                req.write_text("\n".join(lines) + "\n")
                done.append("relaxed version pins")
                reinstall = True
        elif kind == "replace":
            p = root / op["path"]
            if p.exists() and op.get("old") and op["old"] in p.read_text(encoding="utf-8"):
                p.write_text(p.read_text(encoding="utf-8").replace(op["old"], op.get("new", "")), encoding="utf-8")
                done.append(f"edited {op['path']}")
        elif kind == "write":
            if ".." not in Path(op["path"]).parts:
                write_files(root, {op["path"]: op.get("content", "")})
                done.append(f"rewrote {op['path']}")
        elif kind == "set_config":
            set_config_values(run_id, {op["key"]: op["value"]}, op.get("source", "compute_change"), op.get("reason", "fix"))
            done.append(f"set {op['key']}={op['value']}")
    return done, reinstall


# ---------- child runs ----------

COPY_IGNORE = shutil.ignore_patterns(".git", "logs", "results", "__pycache__", ".pytest_cache")


def remove_tree(path: Path) -> None:
    """rmtree that also removes read-only files (git objects are read-only on Windows)."""
    def make_writable_and_retry(func, p, _exc):
        os.chmod(p, stat.S_IWRITE)
        func(p)

    if path.exists():
        shutil.rmtree(path, onexc=make_writable_and_retry)


def fresh_project(run_id: int) -> Path:
    """A new run always starts from an empty project folder (never reuse leftovers)."""
    r = run_row(run_id)
    p = project_dir(r["workspace_id"], run_id)
    remove_tree(p)
    p.mkdir(parents=True, exist_ok=True)
    return p


def create_child_run(parent_id: int, kind: str, branch: str) -> int:
    parent = run_row(parent_id)
    child_id = db.scalar("""INSERT INTO runs (workspace_id, parent_run_id, kind, branch_name, compute_budget, status, stage,
                                started_at, primary_metric, primary_higher_is_better)
                            VALUES (%s,%s,%s,%s,%s,'running',%s, now(), %s, %s) RETURNING id""",
                         (parent["workspace_id"], parent_id, kind, branch, parent["compute_budget"], kind,
                          parent["primary_metric"], parent["primary_higher_is_better"]))
    src = pdir(parent_id)
    dst = project_dir(parent["workspace_id"], child_id)
    remove_tree(dst)
    shutil.copytree(src, dst, ignore=COPY_IGNORE)
    for s in load_settings(parent_id):
        record_settings(child_id, [s])
    return child_id


def finish_run(run_id: int, status: str, error: str = "") -> None:
    db.ex("UPDATE runs SET status=%s, error=%s, finished_at=now() WHERE id=%s", (status, error[:2000], run_id))


def latest_metric(run_id: int, name: str) -> dict | None:
    return db.q1("SELECT * FROM metrics WHERE run_id=%s AND name=%s ORDER BY id DESC LIMIT 1", (run_id, name))


def fmt(v) -> str:
    """Format a database number for text (numbers in text always come from the database)."""
    if v is None:
        return "n/a"
    f = float(v)
    return str(int(f)) if f.is_integer() else f"{f:.4g}"
