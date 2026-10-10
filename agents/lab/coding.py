"""Coding Agent: Code Writer (2.1) and Code Reviewer and Debugger (2.2), settings with their
sources, the environment fix for version conflicts and the Compute Budget Planner test drive.

Contract for every generated project (also given to the AI writer):
  configs/config.yaml   every setting (written by us from the settings table)
  src/train.py          reads the config, trains/evaluates, prints "name: value" lines and
                        writes results/metrics.json (flat {name: number}); honours
                        LAB_BUDGET_FRACTION (scale epochs) and LAB_MAX_STEPS (test drive ->
                        results/timing.json with estimated_seconds)
  src/download_data.py  (optional) downloads data into data/ during the install step
  requirements.txt      package names; the sandbox already has torch (CPU), torchvision, numpy, pandas,
                        scikit-learn, xgboost, scipy, matplotlib, pytest, pyyaml - do not pin those
                        (exact versions are written automatically after install)
"""
from __future__ import annotations

import json
import logging
import re

from . import api, bus, llm, memory, recipes, steps
from .config import settings as cfg
from .observer import edge, node
from .project import apply_ops, load_settings, pdir, record_settings, write_config, write_files

log = logging.getLogger("lab.coding")

BUDGET_SECONDS = {"quick": 300, "standard": 900, "deep": 3600}

CONTRACT = __doc__.split("Contract for every generated project (also given to the AI writer):", 1)[1]

# Pre-installed in the sandbox image; a different pinned version would trigger a huge download
# (e.g. the CUDA build of torch from PyPI), so pins on these are removed before installing.
PREINSTALLED = {"torch", "torchvision", "numpy", "pandas", "scikit-learn", "sklearn", "xgboost", "scipy",
                "matplotlib", "pytest", "pyyaml", "tqdm", "requests"}


def unpin_preinstalled(text: str) -> tuple[str, list[str]]:
    out, changed = [], []
    for line in text.splitlines():
        name = re.split(r"[<>=!~\[ ;]", line.strip(), maxsplit=1)[0].lower()
        if name in PREINSTALLED and name != line.strip().lower():
            out.append(name)
            changed.append(line.strip())
        elif line.strip():
            out.append(line.strip())
    return "\n".join(out) + "\n", changed


PIP_NAMES = {"sklearn": "scikit-learn", "cv2": "opencv-python-headless", "yaml": "pyyaml", "PIL": "pillow",
             "skimage": "scikit-image", "torch_geometric": "torch-geometric"}


def _norm(v: str) -> str:
    """Compare config values loosely: quotes, spacing and case do not matter."""
    v = v.strip().strip('"').strip("'")
    try:
        return json.dumps(json.loads(v), sort_keys=True)
    except ValueError:
        return re.sub(r"\s+", "", v).lower()


def recipe_for(brief: dict):
    p = brief["papers"][0]
    return recipes.find(p.get("title", ""), p.get("arxiv_id", ""), p.get("summary", ""))


# ---------- settings ----------

def plan_settings(run_id: int, brief: dict, budget: str) -> list[dict]:
    """Every setting with its source (Missing Details Log): paper, our assumption for details the
    paper does not state, or changed to fit the compute budget."""
    recipe = recipe_for(brief)
    paper = brief["papers"][0]
    if recipe:
        items = recipe.settings(budget)
    else:
        items = []
        for s in paper.get("settings") or []:
            if s.get("name"):
                items.append({"name": str(s["name"]), "value": s.get("value", ""), "source": "paper",
                              "source_ref": f"p.{s['page']}" if s.get("page") else "", "reason": (s.get("quote") or "")[:200]})
        items.append({"name": "seed", "value": 0, "source": "assumption", "reason": "fixed seed for repeatable runs"})

    compute = [s for s in items if s["source"] == "compute_change"]
    assumed = [s for s in items if s["source"] == "assumption"]
    with steps.step(run_id, "coding.writer", f"Choosing settings for the '{budget}' budget ({BUDGET_SECONDS[budget] // 60} minutes)",
                    "Every setting is labelled: from the paper, our assumption, or changed to fit compute") as t:
        for s in compute:
            bus.emit(run_id, t.slug, "assumption", f"{s['name']} = {s['value']} (paper: {s.get('paper_value') or 'n/a'})",
                     s.get("reason", ""), {"setting": s["name"], "source": "compute_change"})
        for s in assumed:
            bus.emit(run_id, t.slug, "assumption", f"{s['name']} = {s['value']}", s.get("reason", ""),
                     {"setting": s["name"], "source": "assumption"})
        record_settings(run_id, items)
        t.notes = f"{len(items)} settings ({len(compute)} compute changes, {len(assumed)} assumptions)"
    return items


def apply_researcher_edit(run_id: int, instruction: str) -> list[str]:
    """Turn a plan edit ('use only 10,000 training images') into setting changes."""
    names = [s["name"] for s in load_settings(run_id)]
    changes: dict = {}
    if llm.available():
        data, _ = llm.chat_json("fast", "Map the researcher's instruction to changes of existing config settings. "
                                'JSON: {"changes": {"setting.name": value}}. Use only names from the list.',
                                f"Settings: {names}\nInstruction: {instruction}")
        if isinstance(data, dict):
            changes = {k: v for k, v in (data.get("changes") or {}).items() if k in names}
    if not changes:
        t = instruction.lower().replace(",", "")
        num = lambda pat: (m := re.search(pat, t)) and int(float(m.group(1)))  # noqa: E731
        if (n := num(r"(\d+(?:\.\d+)?)\s*(?:k\s*)?(?:training\s*)?(?:images|samples|examples)")):
            if re.search(r"\d\s*k\b", t):
                n *= 1000
            for k in names:
                if "subset" in k or "train_size" in k:
                    changes[k] = n
        if (n := num(r"(\d+)\s*epochs?")):
            changes.update({k: n for k in names if "epoch" in k})
        if (n := num(r"temperature\s*(?:of|=|to)?\s*(\d+(?:\.\d+)?)")):
            changes.update({k: n for k in names if "temperature" in k})
        if (n := num(r"batch\s*size\s*(?:of|=|to)?\s*(\d+)")):
            changes.update({k: n for k in names if "batch" in k})
    if changes:
        record_settings(run_id, [{"name": k, "value": v, "source": "researcher", "reason": f"researcher: {instruction}"}
                                 for k, v in changes.items()])
    return [f"{k} = {v}" for k, v in changes.items()]


# ---------- Code Writer ----------

def write_code(run_id: int, brief: dict) -> dict:
    root = pdir(run_id)
    recipe = recipe_for(brief)
    slug = "coding.writer"
    with steps.step(run_id, slug, "Writing the project: data loading, model, training, evaluation",
                   "Every number must come from results/metrics.json written by this code") as t:
        if recipe:
            files = recipe.files()
            t.notes = f"used tested recipe '{recipe.NAME}' from Lab Memory"
            bus.emit(run_id, slug, "progress", f"Recognised '{recipe.TITLE}': starting from a tested recipe in Lab Memory",
                     "A recipe that worked before saves time and avoids known errors")
        elif llm.available():
            files = _llm_write(run_id, brief, slug)
            if not files:
                raise RuntimeError("the AI code writer returned no files")
            t.notes = f"AI wrote {len(files)} files"
        else:
            raise NoCodeSource()
        if "requirements.txt" in files:
            files["requirements.txt"], unpinned = unpin_preinstalled(files["requirements.txt"])
            if unpinned:
                bus.emit(run_id, slug, "progress", "Using the sandbox's pre-installed versions of: " + ", ".join(unpinned),
                         "Pinning a different version would download gigabytes (e.g. the CUDA build of PyTorch)")
        written = write_files(root, files)
        write_config(root, load_settings(run_id))
        written.append("configs/config.yaml")
        nodes = [node(f"file:{f}", "file", f, "done") for f in written if f.endswith((".py", ".R", ".yaml"))]
        edges_ = [edge(f"file:{f}", "agent:" + slug, "written by") for f in written if f.endswith(".py")]
        bus.emit(run_id, slug, "files_written", f"Created {len(written)} files: " + ", ".join(sorted(written)[:8]),
                 "", {"files": written, "map_nodes": nodes, "map_edges": edges_})
    return {"files": written, "recipe": recipe.NAME if recipe else None}


class NoCodeSource(Exception):
    def __str__(self):
        return ("No AI provider is configured (GROQ_API_KEY / GEMINI_API_KEY) and there is no built-in recipe for this "
                "paper, so code cannot be written automatically.")


def _llm_write(run_id: int, brief: dict, slug: str) -> dict[str, str]:
    paper = brief["papers"][0]
    settings_ = load_settings(run_id)
    extra = "\n".join(bus.instructions(run_id, "coding"))
    data, _ = llm.chat_json("planner",
        steps.instructions(slug) + "\nYou write complete, runnable Python projects for CPU. Follow this contract exactly:\n"
        + CONTRACT + '\nReturn JSON {"files": {"path": "content"}, "notes": "..."}. Do not include configs/config.yaml '
        "(it is generated from the settings). Use only settings names given. Keep training small enough for a laptop CPU.",
        json.dumps({"paper": {k: paper.get(k) for k in ("title", "summary", "method", "claims", "missing_details")},
                    "settings": [{"name": s["name"], "value": s["value"]} for s in settings_],
                    "metric_names_required": [c["metric_name"] for c in paper.get("claims", [])],
                    "field": paper.get("field", ""), "researcher_instructions": extra}, default=str),
        max_tokens=8000)
    files = (data or {}).get("files") if isinstance(data, dict) else None
    return {k: v for k, v in (files or {}).items() if isinstance(v, str) and k != "configs/config.yaml"}


# ---------- Code Reviewer (before running) ----------

def review(run_id: int, brief: dict) -> list[str]:
    root = pdir(run_id)
    slug = "coding.reviewer"
    issues: list[str] = []
    with steps.step(run_id, slug, "Reviewing the code against the Research Brief before running",
                   "Catching a wrong setting now is cheaper than a wasted run") as t:
        cfg_text = (root / "configs" / "config.yaml").read_text(encoding="utf-8")
        for s in load_settings(run_id):
            if s["source"] == "paper":
                key = s["name"].split(".")[-1]
                m = re.search(rf"^\s*{re.escape(key)}:\s*(.*?)(?:\s+#.*)?$", cfg_text, flags=re.M)
                if m and _norm(m.group(1)) != _norm(str(s["value"])):
                    issues.append(f"{s['name']} is {m.group(1)} in the config but the paper says {s['value']}")
        train = root / "src" / "train.py"
        if not train.exists():
            issues.append("src/train.py is missing")
        elif "metrics.json" not in train.read_text(encoding="utf-8"):
            issues.append("src/train.py does not write results/metrics.json")
        if llm.available() and train.exists():
            res = llm.chat("reviewer", steps.instructions(slug) + " You cannot run code or call tools: read the code and "
                           "list concrete mismatches between the code and the paper as plain text (one per line, max 5). "
                           "Reply 'OK' if none.",
                           f"Brief: {json.dumps(brief['papers'][0].get('method'))}\nConfig:\n{cfg_text}\nCode:\n"
                           + train.read_text(encoding="utf-8")[:12000], max_tokens=600)
            if res and res.text.strip().upper() != "OK" and "<tool_call>" not in res.text and "<function" not in res.text:
                issues += [l.strip("-• ").strip() for l in res.text.splitlines()
                           if l.strip() and l.strip().upper() != "OK" and not l.strip().startswith("<")][:5]
        if issues:
            write_config(root, load_settings(run_id))  # the config is regenerated from the settings table
            bus.emit(run_id, slug, "review", f"Review found {len(issues)} issue(s): " + "; ".join(issues[:3]),
                     "Fixed before running", {"issues": issues})
        else:
            bus.emit(run_id, slug, "review", "Review passed: code matches the Research Brief", "")
        t.notes = "; ".join(issues)[:500]
    return issues


# ---------- sandbox steps ----------

INSTALL_CMD = (
    "set -e; "
    "if [ -s requirements.txt ]; then python -m pip install --user --disable-pip-version-check -q -r requirements.txt; fi; "
    "if [ -f src/download_data.py ]; then python src/download_data.py; fi; "
    "python - <<'EOF'\n"
    "import re, importlib.metadata as md\n"
    "lines=[l.strip() for l in open('requirements.txt') if l.strip() and not l.startswith('#')]\n"
    "out=[]\n"
    "for l in lines:\n"
    "    name=re.split(r'[<>=!~\\[ ]', l, maxsplit=1)[0]\n"
    "    try: out.append(f'{name}=={md.version(name)}')\n"
    "    except md.PackageNotFoundError: out.append(l)\n"
    "open('requirements.txt','w').write('\\n'.join(out)+'\\n')\n"
    "print('pinned', ', '.join(out))\n"
    "EOF"
)


def install(run_id: int, agent: str, timeout: int = 1200) -> api.ExecResult:
    return api.sandbox_exec(run_id, "install", INSTALL_CMD, timeout, agent)


def test_drive(run_id: int, budget: str) -> dict:
    """Compute Budget Planner: a ~20 second test drive to estimate the full run on this computer."""
    slug = "coding.writer"
    res = api.sandbox_exec(run_id, "execute", "python src/train.py", 180, slug,
                           env={"LAB_MAX_STEPS": "40"}, collect_metrics=False)
    timing = {}
    tf = pdir(run_id) / "results" / "timing.json"
    if res.ok and tf.exists():
        try:
            timing = json.loads(tf.read_text())
        except ValueError:
            pass
    est = float(timing.get("estimated_seconds") or 0)
    out = {"estimated_seconds": est, "budget_seconds": BUDGET_SECONDS[budget], "ok": res.ok, "exec": res}
    if est:
        bus.emit(run_id, slug, "budget_estimate",
                 f"Test drive: full run estimated at {est / 60:.1f} min on this computer (budget {BUDGET_SECONDS[budget] // 60} min)",
                 "Measured speed with a few training steps before committing to the full run",
                 {"estimated_seconds": est, "budget_seconds": BUDGET_SECONDS[budget]})
    return out


def execute(run_id: int, timeout: int, env: dict | None = None) -> api.ExecResult:
    slug = "coding.writer"
    return api.sandbox_exec(run_id, "execute", "python src/train.py", timeout, slug, env=env or {})


# ---------- Debugger (after running) ----------

def heuristic_fix(log_tail: str) -> tuple[list[dict], str] | None:
    m = re.search(r"No module named '([\w.]+)'", log_tail)
    if m:
        mod = m.group(1).split(".")[0]
        pkg = PIP_NAMES.get(mod, mod.replace("_", "-"))
        return [{"op": "add_requirement", "value": pkg}], f"install missing package {pkg}"
    if re.search(r"numpy\.core\.multiarray failed to import|A module that was compiled using NumPy 1\.x|_ARRAY_API not found", log_tail):
        return [{"op": "add_requirement", "value": "numpy<2"}], "pin numpy<2 (NumPy 2.0 breaks this code)"
    if "Torch not compiled with CUDA enabled" in log_tail or "Found no NVIDIA driver" in log_tail:
        return [{"op": "replace_all_cuda"}], "run on CPU instead of CUDA"
    if re.search(r"Killed|out of memory|MemoryError|DefaultCPUAllocator", log_tail):
        return [{"op": "set_config", "key": "train.batch_size", "value": 32, "reason": "halved memory use after running out of memory"}], \
            "reduce batch size after running out of memory"
    return None


def _cuda_to_cpu(run_id: int) -> list[dict]:
    ops = []
    for p in (pdir(run_id) / "src").rglob("*.py"):
        t = p.read_text(encoding="utf-8")
        new = re.sub(r"\.cuda\(\)", ".to('cpu')", t).replace("device='cuda'", "device='cpu'").replace('device="cuda"', 'device="cpu"')
        if new != t:
            ops.append({"op": "write", "path": p.relative_to(pdir(run_id)).as_posix(), "content": new})
    return ops


def llm_fix(run_id: int, log_tail: str, slug: str) -> tuple[list[dict], str] | None:
    if not llm.available():
        return None
    root = pdir(run_id)
    files = {p.relative_to(root).as_posix(): p.read_text(encoding="utf-8", errors="ignore")[:8000]
             for p in list((root / "src").rglob("*.py"))[:6]}
    req = (root / "requirements.txt").read_text() if (root / "requirements.txt").exists() else ""
    data, _ = llm.chat_json("planner", steps.instructions(slug) + "\nFind the cause of the error and fix it with minimal "
        'changes. JSON: {"cause": "...", "ops": [{"op": "replace", "path": "...", "old": "exact text", "new": "..."} | '
        '{"op": "write", "path": "...", "content": "..."} | {"op": "add_requirement", "value": "pkg==ver"}]}',
        json.dumps({"error_log_tail": log_tail[-6000:], "requirements": req, "files": files,
                    "researcher_instructions": bus.instructions(run_id, "coding")}), max_tokens=6000)
    if isinstance(data, dict) and data.get("ops"):
        return data["ops"], str(data.get("cause", "AI fix"))[:200]
    return None


def ensure_installed(run_id: int, help_instruction: str = "", max_tries: int = 4) -> tuple[bool, str]:
    """Install step with repair: fixes from memory/patterns/AI, Environment Fixer after two failures."""
    root = pdir(run_id)
    if (root / ".needs_install").exists():
        (root / ".needs_install").unlink()
        (root / ".installed").unlink(missing_ok=True)
    if (root / ".installed").exists():
        return True, ""
    reviewer = "coding.reviewer"
    tail = ""
    for attempt in range(1, max_tries + 1):
        bus.check_control(run_id)
        res = install(run_id, "coding.writer")
        if res.ok:
            (root / ".installed").write_text("ok")
            (root / ".needs_install").unlink(missing_ok=True)
            return True, ""
        tail = res.log_tail
        if attempt >= 2:
            _environment_fixer(run_id, tail)
        elif not _fix(run_id, reviewer, tail, attempt, help_instruction):
            return False, tail
    return False, tail


def repair_and_run(run_id: int, timeout: int, env: dict | None = None,
                   help_instruction: str = "") -> tuple[api.ExecResult | None, str]:
    """write -> run -> read the error -> fix loop. Returns (successful result, '') or (None, last error)."""
    reviewer = "coding.reviewer"
    max_tries = cfg.max_repair_attempts
    last_tail = ""
    if help_instruction:
        bus.emit(run_id, reviewer, "progress", f"Applying the researcher's help: {help_instruction}", "")
    for attempt in range(1, max_tries + 2):
        bus.check_control(run_id)
        ok, tail = ensure_installed(run_id, help_instruction)
        if not ok:
            return None, tail
        res = execute(run_id, timeout, env)
        if res.ok and res.metrics:
            return res, ""
        last_tail = res.log_tail if not res.ok else (res.metrics_error or "the code ran but wrote no metrics.json")
        if res.timed_out:
            last_tail += "\n[the run hit its time limit]"
        if attempt > max_tries:
            break
        if not _fix(run_id, reviewer, last_tail, attempt, help_instruction):
            break
    return None, last_tail


def _fix(run_id: int, slug: str, log_tail: str, attempt: int, help_instruction: str) -> bool:
    """One debugging step: Lab Memory first, then known patterns, then the AI debugger."""
    with steps.step(run_id, slug, f"Reading the error and fixing it (attempt {attempt})",
                   "Lab Memory is searched first: a known fix is applied immediately") as t:
        sig = memory.error_signature(log_tail)
        bus.emit(run_id, slug, "error_seen", f"Error: {sig[:200]}", "", {"signature": sig})
        known = memory.find_fix(log_tail)
        if known:
            ops = known["details"].get("ops", [])
            done, reinstall = apply_ops(run_id, _expand(run_id, ops))
            src = known.get("source_run_id")
            bus.emit(run_id, slug, "fix_applied",
                     f"Fixed from memory: {known['details'].get('description', '')} (" + ", ".join(done) + ")",
                     f"Same error seen in run #{src}; that fix worked" if src else "Known fix from Lab Memory",
                     {"memory_item": known["id"], "from_memory": True, "learned_in_run": src})
            _mark_pending(run_id, known["id"], log_tail, ops, known["details"].get("description", ""), reinstall)
            t.notes = f"fixed from memory item {known['id']}"
            return True
        found = heuristic_fix(log_tail) or llm_fix(run_id, log_tail, slug)
        if help_instruction and not found:
            found = llm_fix(run_id, log_tail + "\nResearcher says: " + help_instruction, slug)
        if not found:
            t.notes = f"no fix found for: {sig[:200]}"
            bus.emit(run_id, slug, "fix_failed", "No fix found for this error", sig[:200])
            return False
        ops, desc = found
        done, reinstall = apply_ops(run_id, _expand(run_id, ops))
        if not done:
            t.notes = "fix could not be applied"
            return False
        bus.emit(run_id, slug, "fix_applied", f"Fix: {desc} (" + ", ".join(done) + ")", "Found by reading the error",
                 {"from_memory": False})
        _mark_pending(run_id, None, log_tail, ops, desc, reinstall)
        t.notes = desc
        return True


def _expand(run_id: int, ops: list[dict]) -> list[dict]:
    out = []
    for op in ops:
        out += _cuda_to_cpu(run_id) if op.get("op") == "replace_all_cuda" else [op]
    return out


def _mark_pending(run_id, memory_id, log_tail, ops, desc, reinstall) -> None:
    root = pdir(run_id)
    pending = json.loads((root / ".pending_fixes.json").read_text()) if (root / ".pending_fixes.json").exists() else []
    pending.append({"memory_id": memory_id, "log_tail": log_tail[-4000:], "ops": ops, "desc": desc})
    (root / ".pending_fixes.json").write_text(json.dumps(pending))
    if reinstall:
        (root / ".needs_install").write_text("1")


def confirm_fixes(run_id: int, success: bool) -> None:
    """After a run: fixes that led to success are saved to (or confirmed in) Lab Memory."""
    root = pdir(run_id)
    f = root / ".pending_fixes.json"
    if not f.exists():
        return
    for p in json.loads(f.read_text()):
        if p["memory_id"]:
            memory.mark_used(p["memory_id"], success)
        elif success:
            mid = memory.save_fix(p["log_tail"], p["ops"], p["desc"], run_id)
            bus.emit(run_id, "coding.reviewer", "memory_saved", f"Saved to Lab Memory: {p['desc']}",
                     "The next run with this error will fix it immediately", {"memory_item": mid})
    f.unlink()


def _environment_fixer(run_id: int, log_tail: str) -> None:
    """Installation failed twice: the Debugger relaxes version pins to find compatible libraries."""
    slug = "coding.reviewer"
    with steps.step(run_id, slug, "Installation failed twice: finding compatible library versions",
                   "Version conflicts are the most common reason research code does not run") as t:
        ops = [{"op": "remove_pins"}]
        h = heuristic_fix(log_tail)
        if h:
            ops += h[0]
        done, _ = apply_ops(run_id, ops)
        (pdir(run_id) / ".needs_install").write_text("1")
        bus.emit(run_id, slug, "fix_applied", "Environment fix: " + ", ".join(done), "")
        _mark_pending(run_id, None, log_tail, ops, "relax version pins after install conflicts", True)
        t.notes = ", ".join(done)
