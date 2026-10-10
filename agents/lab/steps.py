"""The fixed agents of the pipeline and the `step()` helper that runs one unit of agent work.

Pipeline: Research (Paper Reader, Source Finder) -> plan approval -> Coding (Code Writer,
Code Reviewer and Debugger) -> Testing (Test Designer, Test Runner) -> Gap Detective,
plus What-If branches on request. The Observer draws the map from their events.
"""
from __future__ import annotations

import time
from contextlib import contextmanager
from dataclasses import dataclass, field

from . import bus, llm

AGENTS = {
    "research.paper_reader": ("Paper Reader",
        "Get the paper text in the most accurate way (arXiv LaTeX source, then PDF text). Produce a plain summary, the "
        "method step by step, every setting with its page, the Claims List (every reported result number with page, "
        "table and condition) and the Missing Details List."),
    "research.source_finder": ("Source Finder",
        "Study the uploaded repository and dataset, or search GitHub, Semantic Scholar and arXiv. Check if each source "
        "is official, its licence, its size and whether it fits the compute budget."),
    "coding.writer": ("Code Writer",
        "Write a clean project: data loading, model, training, evaluation and one configuration file with every "
        "setting. Every script writes its results to results/metrics.json. Keep it runnable on a laptop CPU."),
    "coding.reviewer": ("Code Reviewer and Debugger",
        "Before running, review the code against the Research Brief. After running, read errors, use a known fix from "
        "Lab Memory first, then find the cause and fix it with minimal changes. Fix library version conflicts too."),
    "testing.designer": ("Test Designer",
        "Write correctness tests (code does the right thing) and claim tests (each result vs the paper with a tolerance)."),
    "testing.runner": ("Test Runner",
        "Run all tests inside the sandbox and fill the Claim Scorecard: Match, Close or Different for every claim."),
    "gap_detective": ("Gap Detective",
        "A claim is Different. List every setup difference, rank them, run a small experiment changing only one thing "
        "for the top differences, measure how much each closes the gap and explain with evidence."),
    "whatif": ("What-If Planner",
        "Turn the researcher's what-if question into small experiments that change only what the question asks."),
    "observer": ("Observer", "Watch every event and keep the live research map of what each agent found and did."),
}


def instructions(slug: str) -> str:
    return AGENTS.get(slug, ("", ""))[1]


def name(slug: str) -> str:
    return AGENTS.get(slug, (slug, ""))[0]


@dataclass
class Step:
    run_id: int
    slug: str
    tokens: list[int] = field(default_factory=lambda: [0])
    sandbox_seconds: float = 0.0
    notes: str = ""


@contextmanager
def step(run_id: int, slug: str, message: str, why: str = ""):
    """One unit of agent work: checks pause/stop, emits start/finish events for the live board,
    and reports the AI tokens and sandbox time it used."""
    bus.check_control(run_id)
    s = Step(run_id=run_id, slug=slug)
    tok = llm.current_tokens.set(s.tokens)
    bus.emit(run_id, slug, "agent_started", message, why)
    started = time.time()
    failed = None
    try:
        yield s
    except bus.RunStopped:
        failed = "stopped"
        raise
    except Exception as e:  # noqa: BLE001
        failed = str(e)
        raise
    finally:
        llm.current_tokens.reset(tok)
        cost = {"tokens": s.tokens[0], "sandbox_seconds": round(s.sandbox_seconds, 1), "seconds": round(time.time() - started, 1)}
        if failed and failed != "stopped":
            bus.emit(run_id, slug, "agent_failed", f"{name(slug)} failed: {failed}"[:300], s.notes[:300], {}, cost)
        else:
            bus.emit(run_id, slug, "agent_finished", f"{name(slug)} finished" + (f": {s.notes}" if s.notes else ""),
                     "", {}, cost)
