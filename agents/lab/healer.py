"""Self-Healing Debugger: detect a failed sandbox execution, diagnose it, apply a minimal patch,
re-run the patched code in a fresh sandbox container, verify with the project's tests, and repeat
at most 3 times. Every attempt is stored (heal_sessions / repair_attempts) with the original
error, the explanation, the exact diff and the real results, for the code sandbox UI.

Token budget (Arina, 8 lakh tokens for the team): a fix is looked up in this order and Arina is
called only when nothing cheaper knows the answer:
  1. Lab Memory (an earlier run fixed the same error)
  2. deterministic patterns (missing package, NumPy 2, CUDA on CPU, out of memory)
  3. the answer cache (same error on the same code: never asked twice)
  4. Arina, with only the traceback and the code around the failing lines, and capped output.
Success is never claimed from the model's answer: only from a real re-run (and tests).
"""
from __future__ import annotations

import difflib
import hashlib
import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path

from . import api, bus, db, llm, memory
from .project import apply_ops, pdir, safe_rel, safe_target

log = logging.getLogger("lab.healer")

MAX_ATTEMPTS = 3
CONTEXT_CHARS = 14_000      # code sent to the model (well under the 48 KB gateway limit)
ERROR_CHARS = 3_000         # error text sent to the model
CACHE_TTL = 7 * 24 * 3600
AGENT = "coding.reviewer"

FRAME_RE = re.compile(r'File "(?P<path>[^"]+)", line (?P<line>\d+)')
EXC_RE = re.compile(r"^(?P<type>[A-Za-z_][\w.]*(?:Error|Exception|Exit|Interrupt|Warning|Failure))(?::\s*(?P<msg>.*))?$")


# ---------- 1. detect ----------

@dataclass
class Failure:
    kind: str                 # exception | timeout | oom | results | tests | install | sandbox_error | cancelled
    summary: str              # one line for people
    text: str                 # the real error output (trimmed)
    error_type: str = ""
    message: str = ""
    frames: list[tuple[str, int]] = field(default_factory=list)   # project-relative (path, line), innermost last

    @property
    def fixable(self) -> bool:
        return self.kind not in ("sandbox_error", "cancelled")


def _project_rel(path: str) -> str | None:
    p = path.replace("\\", "/")
    if p.startswith("/work/"):
        p = p[len("/work/"):]
    elif p.startswith("/"):
        return None  # library code, not ours
    return safe_rel(p, editable_only=True)


def parse_traceback(text: str) -> tuple[str, str, list[tuple[str, int]]]:
    """(exception type, message, project frames) from the last Python traceback in the output."""
    start = text.rfind("Traceback (most recent call last)")
    chunk = text[start:] if start >= 0 else text
    frames = []
    for m in FRAME_RE.finditer(chunk):
        rel = _project_rel(m.group("path"))
        if rel:
            frames.append((rel, int(m.group("line"))))
    etype, msg = "", ""
    for line in reversed([l.strip() for l in chunk.splitlines() if l.strip()]):
        m = EXC_RE.match(line)
        if m:
            etype, msg = m.group("type"), (m.group("msg") or "").strip()
            break
    return etype, msg, frames


def detect_failure(res: api.ExecResult) -> Failure | None:
    """Classify a sandbox result using its status, exit code, stderr and traceback."""
    if res.ok:
        return None
    output = (res.stderr_tail or "") + "\n" + (res.log_tail or "")
    text = (res.stderr_tail or res.log_tail or "")[-ERROR_CHARS:]
    if res.status == "error":
        return Failure("sandbox_error", f"The sandbox could not run the code: {res.error}", res.error or text)
    if res.cancelled or res.status == "cancelled":
        return Failure("cancelled", "The run was cancelled", res.error)
    if res.timed_out or res.status == "timed_out":
        return Failure("timeout", "The run hit its time limit", (res.error + "\n" + res.log_tail[-1500:]).strip())
    if "out of memory" in (res.error or "") or res.exit_code == 137:
        return Failure("oom", "The run ran out of memory", (res.error + "\n" + res.log_tail[-1500:]).strip())
    etype, msg, frames = parse_traceback(output)
    if etype:
        where = f" ({frames[-1][0]} line {frames[-1][1]})" if frames else ""
        return Failure("exception", f"{etype}: {msg[:160]}{where}", text, etype, msg, frames)
    if res.exit_code == 0 and res.metrics_status in ("invalid", "missing"):
        err = res.metrics_error or "the code did not write results/metrics.json"
        return Failure("results", f"Results rejected: {err[:200]}", f"[sandbox] results rejected: {err}\n{res.log_tail[-1500:]}")
    return Failure("exception", f"Exited with code {res.exit_code}: {(res.error or '')[:160]}",
                   (res.error + "\n" + text).strip())


# ---------- 2. context (only what the model needs) ----------

def _numbered_window(lines: list[str], center: int, radius: int) -> tuple[int, int]:
    return max(1, center - radius), min(len(lines), center + radius)


def relevant_context(root: Path, failure: Failure, limit: int = CONTEXT_CHARS) -> str:
    """The failing files (whole if short, otherwise the lines around each traceback frame),
    plus requirements.txt for import errors and the config for KeyErrors."""
    parts: list[str] = []
    files: dict[str, list[int]] = {}
    for rel, line in failure.frames[-4:]:
        files.setdefault(rel, []).append(line)
    if not files:
        main = "src/train.py" if (root / "src" / "train.py").is_file() else next(
            (p.relative_to(root).as_posix() for p in sorted((root / "src").glob("*.py"))), None) if (root / "src").is_dir() else None
        if main:
            files[main] = []
    for rel, lines_at in files.items():
        p = safe_target(root, rel)
        if p is None or not p.is_file():
            continue
        src = p.read_text(encoding="utf-8", errors="replace").splitlines()
        if len(src) <= 160 or not lines_at:
            body = "\n".join(src[:400])
            parts.append(f"### {rel} (whole file)\n{body}")
        else:
            spans: list[tuple[int, int]] = []
            for ln in sorted(set(lines_at)):
                a, b = _numbered_window(src, ln, 30)
                if spans and a <= spans[-1][1] + 1:
                    spans[-1] = (spans[-1][0], max(spans[-1][1], b))
                else:
                    spans.append((a, b))
            for a, b in spans:
                parts.append(f"### {rel} (lines {a}-{b} of {len(src)})\n" + "\n".join(src[a - 1:b]))
    low = failure.text.lower()
    if "modulenotfound" in low or "importerror" in low or "no module named" in low or failure.kind == "install":
        req = root / "requirements.txt"
        if req.is_file() and not req.is_symlink():
            parts.append("### requirements.txt\n" + req.read_text(encoding="utf-8", errors="replace")[:1500])
    if failure.error_type == "KeyError" or "config" in low:
        cfgp = root / "configs" / "config.yaml"
        if cfgp.is_file() and not cfgp.is_symlink():
            parts.append("### configs/config.yaml\n" + cfgp.read_text(encoding="utf-8", errors="replace")[:2000])
    out = "\n\n".join(parts)
    return out[:limit]


# ---------- 3. diagnose ----------

@dataclass
class Diagnosis:
    source: str               # memory | pattern | cache | arina | fallback_ai
    cause: str
    explanation: str
    ops: list[dict]
    tokens: int = 0
    memory_id: int | None = None


SYSTEM = (
    "You repair Python ML research code that failed inside a sandbox (Linux, CPU only, no network while running, "
    "project read-only except results/, models/, data/ and /tmp; numpy, torch, sklearn, pandas, xgboost, scipy, "
    "matplotlib, pyyaml are installed). Find the root cause and propose the SMALLEST change that fixes it. "
    "Keep the experiment's intent: never fake, hardcode or skip results, never write metric values yourself, "
    "never silence the error with a bare try/except. "
    'Reply with JSON only: {"cause": "one sentence", "explanation": "at most 3 short sentences in plain words", '
    '"edits": [{"path": "src/x.py", "old": "exact text copied from the file, unique, a few lines", "new": "replacement"}], '
    '"requirements": ["package"]}. Only edit files shown. Use [] when no edit is needed.'
)


def _cache_key(failure: Failure, context: str) -> str:
    sig = memory.error_signature(failure.text) or failure.summary
    return "lab:heal:cache:" + hashlib.sha256((sig + "\n" + context).encode()).hexdigest()[:40]


def _cache_get(key: str) -> dict | None:
    try:
        raw = bus.r.get(key)
        return json.loads(raw) if raw else None
    except Exception:  # noqa: BLE001
        return None


def _cache_put(key: str, value: dict) -> None:
    try:
        bus.r.set(key, json.dumps(value), ex=CACHE_TTL)
    except Exception as e:  # noqa: BLE001
        log.warning("heal cache unavailable: %s", e)


def edits_to_ops(root: Path, data: dict) -> list[dict]:
    """Validate the model's edits: editable files only, and each 'old' must occur exactly once."""
    ops: list[dict] = []
    for e in (data.get("edits") or [])[:8]:
        if not isinstance(e, dict):
            continue
        rel = safe_rel(str(e.get("path", "")), editable_only=True)
        p = safe_target(root, rel) if rel else None
        old, new = e.get("old"), e.get("new")
        if p is None or not p.is_file() or not isinstance(old, str) or not isinstance(new, str) or not old or old == new:
            continue
        if p.read_text(encoding="utf-8", errors="replace").count(old) != 1:
            continue
        ops.append({"op": "replace", "path": rel, "old": old, "new": new})
    for pkg in (data.get("requirements") or [])[:5]:
        if isinstance(pkg, str) and re.fullmatch(r"[A-Za-z0-9_.\-\[\]]+([<>=!~]=?[A-Za-z0-9_.*]+)?", pkg.strip()):
            ops.append({"op": "add_requirement", "value": pkg.strip()})
    return ops


def ask_ai(root: Path, failure: Failure) -> Diagnosis | None:
    """Cached model diagnosis. Arina first; the existing Groq/Gemini chain only if Arina is unavailable."""
    context = relevant_context(root, failure)
    key = _cache_key(failure, context)
    cached = _cache_get(key)
    if cached is not None:
        if cached.get("none"):
            return None
        return Diagnosis("cache", cached["cause"], cached["explanation"], cached["ops"])
    user = f"Error output:\n{failure.text[-ERROR_CHARS:]}\n\nCode:\n{context}"
    data, tokens, source = None, 0, "arina"
    res = llm.invoke("debugging", SYSTEM, user, max_tokens=2500)
    if res is not None:
        data, tokens = res.json(), res.tokens
        source = "arina" if res.provider == "arina" else "fallback_ai"  # a fallback only happens with ARINA_FALLBACK_TO_SHARED=true
    else:
        log.warning("the debugging model gave no answer: %s", llm.last_error())
    if not isinstance(data, dict):
        return None
    ops = edits_to_ops(root, data)
    cause = str(data.get("cause", ""))[:300]
    expl = str(data.get("explanation", ""))[:800]
    _cache_put(key, {"cause": cause, "explanation": expl, "ops": ops} if ops else {"none": True})
    if not ops:
        return None
    return Diagnosis(source, cause, expl, ops, tokens)


def diagnose(root: Path, failure: Failure) -> Diagnosis | None:
    from . import coding  # deterministic patterns live with the Coding Agent
    known = memory.find_fix(failure.text)
    if known and known.get("details", {}).get("ops"):
        d = known["details"]
        src = known.get("source_run_id")
        return Diagnosis("memory", d.get("description", "known fix"),
                         f"The same error was fixed before{f' in run #{src}' if src else ''}; reusing that fix.",
                         coding._expand_ops(root, d["ops"]), memory_id=known["id"])
    h = coding.heuristic_fix(failure.text)
    if h:
        ops, desc = h
        return Diagnosis("pattern", desc, f"Recognised a common problem: {desc}.", coding._expand_ops(root, ops))
    return ask_ai(root, failure)


# ---------- 4. patch with a diff ----------

def _snapshot(root: Path, ops: list[dict]) -> dict[str, str]:
    paths = {"requirements.txt"} if any(o.get("op") in ("add_requirement", "remove_pins") for o in ops) else set()
    paths |= {o["path"] for o in ops if o.get("path")}
    out = {}
    for rel in paths:
        r = safe_rel(rel)
        p = safe_target(root, r) if r else None
        out[rel] = p.read_text(encoding="utf-8", errors="replace") if p is not None and p.is_file() else ""
    return out


def apply_with_diff(run_id: int, root: Path, ops: list[dict]) -> tuple[str, list[str], bool]:
    """Apply the patch; returns (unified diff, changed files, needs reinstall)."""
    before = _snapshot(root, ops)
    _done, reinstall = apply_ops(run_id, ops)
    after = _snapshot(root, ops)
    diff, changed = [], []
    for rel in sorted(before):
        if before[rel] != after.get(rel, ""):
            changed.append(rel)
            diff.extend(difflib.unified_diff(before[rel].splitlines(keepends=True), after[rel].splitlines(keepends=True),
                                             fromfile=f"a/{rel}", tofile=f"b/{rel}", n=2))
    return "".join(diff), changed, reinstall


# ---------- 5. verify in a fresh sandbox ----------

TEST_CMD = "PYTHONPATH=src python -m pytest -q tests -p no:cacheprovider --ignore=tests/test_claims.py --junitxml=results/heal-junit.xml"


def run_entry(run_id: int, entry: str, attempt: int, required: list[str] | None) -> api.ExecResult:
    if entry.startswith("tests/"):
        return api.sandbox_exec(run_id, "test", f"PYTHONPATH=src python -m pytest -q {entry} -p no:cacheprovider", 0,
                                AGENT, attempt=attempt, collect_metrics=False)
    return api.sandbox_exec(run_id, "execute", f"python {entry}", 0, AGENT, attempt=attempt, required_metrics=required)


def run_tests(run_id: int, root: Path) -> tuple[dict, api.ExecResult | None]:
    """Correctness tests (claim tests excluded: a paper mismatch is not a bug). No tests: nothing to run."""
    from .testing import _junit
    tests = [p for p in (root / "tests").glob("test_*.py") if p.name != "test_claims.py"] if (root / "tests").is_dir() else []
    if not tests:
        return {"total": 0, "passed": 0, "failed": 0, "skipped": 0, "note": "no tests in tests/"}, None
    res = api.sandbox_exec(run_id, "test", TEST_CMD, 300, AGENT, collect_metrics=False)
    summary = {k: v for k, v in _junit(root / "results" / "heal-junit.xml").items() if k != "cases"}
    if res.status == "error":
        summary["error"] = res.error
    elif not summary["total"] and not res.ok:
        summary["failed"] = 1  # pytest could not even collect the tests
    return summary, res


# ---------- the loop ----------

def _attempt_row(session_id: int, run_id: int, n: int, f: Failure) -> int:
    return db.scalar("""INSERT INTO repair_attempts (session_id, run_id, attempt, error_kind, error_summary, error_text)
                        VALUES (%s,%s,%s,%s,%s,%s) RETURNING id""",
                     (session_id, run_id, n, f.kind, f.summary[:500], f.text[-6000:]))


def _update_attempt(aid: int, **cols) -> None:
    if not cols:
        return
    sets = ", ".join(f"{k}=%s" for k in cols)
    vals = [db.J(v) if k in ("files", "tests") else v for k, v in cols.items()]
    db.ex(f"UPDATE repair_attempts SET {sets} WHERE id=%s", (*vals, aid))


def _finish(session_id: int, status: str, message: str, tokens: int) -> None:
    db.ex("UPDATE heal_sessions SET status=%s, message=%s, tokens=%s, finished_at=now() WHERE id=%s",
          (status, message[:4000], tokens, session_id))


def load_exec(run_id: int, exec_id: int) -> api.ExecResult:
    """A recorded sandbox execution (e.g. the researcher's failed run) with its real log files."""
    row = db.q1("SELECT * FROM sandbox_execs WHERE id=%s AND run_id=%s", (exec_id, run_id))
    if not row:
        raise ValueError(f"execution {exec_id} not found for run {run_id}")
    root = pdir(run_id)

    def tail(rel: str) -> str:
        r = safe_rel(rel or "")
        p = safe_target(root, r) if r else None
        return p.read_text(encoding="utf-8", errors="replace")[-12000:] if p is not None and p.is_file() else ""

    return api.ExecResult(exec_id=row["id"], exit_code=row["exit_code"] if row["exit_code"] is not None else -1,
                          timed_out=row["timed_out"], duration_ms=row["duration_ms"], log_path=row["log_path"],
                          log_hash=row["log_hash"], log_tail=tail(row["log_path"]), code_version=row["code_version"],
                          status=row["status"], attempt=row["attempt"], cancelled=row["cancelled"], error=row["error"],
                          stderr_tail=tail(row["stderr_path"]), metrics_status=row["metrics_status"],
                          metrics_error=row["metrics_error"])


def heal(run_id: int, session_id: int, failed: api.ExecResult, entry: str = "src/train.py",
         max_attempts: int = MAX_ATTEMPTS, required: list[str] | None = None) -> dict:
    """Diagnose -> patch -> re-run in a fresh container -> test, at most `max_attempts` times."""
    root = pdir(run_id)
    db.ex("UPDATE heal_sessions SET status='running' WHERE id=%s", (session_id,))
    failure = detect_failure(failed)
    tokens = 0
    if failure is None:
        _finish(session_id, "fixed", "The last run already succeeded; nothing to fix.", 0)
        return {"status": "fixed", "attempts": 0}
    if not failure.fixable:
        _finish(session_id, "error", f"Not a code problem, so nothing was changed. {failure.summary}", 0)
        return {"status": "error", "attempts": 0}
    applied: set[str] = set()
    for n in range(1, max_attempts + 1):
        bus.emit(run_id, AGENT, "heal_attempt", f"Self-healing attempt {n}: {failure.summary}",
                 "Diagnosing the real error, then re-running in a fresh sandbox", {"session_id": session_id, "attempt": n})
        aid = _attempt_row(session_id, run_id, n, failure)
        d = diagnose(root, failure)
        if d is None:
            _update_attempt(aid, status="no_fix", explanation="No safe fix was found for this error.")
            _finish(session_id, "failed", f"No fix found. Remaining error: {failure.summary}", tokens)
            return {"status": "failed", "attempts": n}
        tokens += d.tokens
        sig = json.dumps(d.ops, sort_keys=True)
        if sig in applied:
            _update_attempt(aid, status="no_fix", fix_source=d.source, explanation=d.explanation, tokens=d.tokens)
            _finish(session_id, "failed", f"The same fix was proposed again. Remaining error: {failure.summary}", tokens)
            return {"status": "failed", "attempts": n}
        applied.add(sig)
        diff, changed, reinstall = apply_with_diff(run_id, root, d.ops)
        _update_attempt(aid, fix_source=d.source, explanation=(d.cause + ("\n" + d.explanation if d.explanation else "")).strip(),
                        diff=diff, files=changed, tokens=d.tokens)
        if not changed:
            _update_attempt(aid, status="no_fix")
            _finish(session_id, "failed", f"The proposed fix did not change any file. Remaining error: {failure.summary}", tokens)
            return {"status": "failed", "attempts": n}

        if reinstall:
            from . import coding
            inst = coding.install(run_id, AGENT, timeout=900)
            if not inst.ok:
                f2 = detect_failure(inst) or failure
                if f2.kind == "sandbox_error":
                    _update_attempt(aid, status="sandbox_error", exec_id=inst.exec_id)
                    _finish(session_id, "error", f2.summary, tokens)
                    return {"status": "error", "attempts": n}
                failure = Failure("install", "Installing the requirements failed", inst.log_tail[-ERROR_CHARS:])
                _update_attempt(aid, status="still_failing", exec_id=inst.exec_id)
                continue

        res = run_entry(run_id, entry, n + (failed.attempt or 1), required)
        new_failure = detect_failure(res)
        if new_failure is not None and new_failure.kind == "sandbox_error":
            _update_attempt(aid, status="sandbox_error", exec_id=res.exec_id)
            _finish(session_id, "error", new_failure.summary, tokens)
            return {"status": "error", "attempts": n}
        if new_failure is not None:
            _update_attempt(aid, status="still_failing", exec_id=res.exec_id)
            failure = new_failure
            continue
        summary, tres = run_tests(run_id, root)
        if tres is not None and tres.status == "error":
            _update_attempt(aid, status="sandbox_error", exec_id=res.exec_id, test_exec_id=tres.exec_id, tests=summary)
            _finish(session_id, "error", f"The tests could not run: {tres.error}", tokens)
            return {"status": "error", "attempts": n}
        if summary.get("failed"):
            _update_attempt(aid, status="tests_failed", exec_id=res.exec_id, test_exec_id=tres.exec_id if tres else None, tests=summary)
            failure = Failure("tests", f"{summary['failed']} test(s) failed after the fix", (tres.log_tail if tres else "")[-ERROR_CHARS:])
            etype, msg, frames = parse_traceback(failure.text)
            failure.error_type, failure.message, failure.frames = etype, msg, frames
            continue
        _update_attempt(aid, status="fixed", exec_id=res.exec_id, test_exec_id=tres.exec_id if tres else None, tests=summary)
        if d.memory_id:
            memory.mark_used(d.memory_id, True)
        elif d.source in ("arina", "fallback_ai", "pattern", "cache"):
            memory.save_fix(failed.stderr_tail or failed.log_tail, d.ops, d.cause, run_id)
        _finish(session_id, "fixed", f"Fixed on attempt {n}: the patched code ran successfully in a fresh sandbox"
                + (f" and {summary['passed']} test(s) passed." if summary.get("total") else "."), tokens)
        bus.emit(run_id, AGENT, "heal_fixed", f"Self-healing fixed the run on attempt {n}", d.cause[:200],
                 {"session_id": session_id, "exec_id": res.exec_id})
        return {"status": "fixed", "attempts": n}
    _finish(session_id, "failed", f"Not fixed after {max_attempts} attempts. Remaining error: {failure.summary}", tokens)
    bus.emit(run_id, AGENT, "heal_failed", f"Self-healing stopped after {max_attempts} attempts", failure.summary[:200],
             {"session_id": session_id})
    return {"status": "failed", "attempts": max_attempts}


def run_session(run_id: int, session_id: int) -> dict:
    """Worker entry point for a 'heal' job queued by the Go API (Fix with AI in the code sandbox)."""
    s = db.q1("SELECT * FROM heal_sessions WHERE id=%s AND run_id=%s", (session_id, run_id))
    if not s or s["status"] not in ("queued",):
        return {"status": "skipped"}
    try:
        failed = load_exec(run_id, s["source_exec_id"])
        return heal(run_id, session_id, failed, s["entrypoint"] or "src/train.py", int(s["max_attempts"] or MAX_ATTEMPTS))
    except Exception as e:  # noqa: BLE001
        log.exception("heal session %s failed", session_id)
        _finish(session_id, "error", f"The debugger stopped: {e}", 0)
        return {"status": "error"}
