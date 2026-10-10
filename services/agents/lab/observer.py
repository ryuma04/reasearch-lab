"""Observer Agent (Hero 7): listens to every event and keeps the live Research Map.

Agents attach structured hints to events (links.map_nodes / links.map_edges); the Observer
merges them into a graph of nodes and edges stored in research_maps. The browser turns the
graph into Excalidraw elements (convertToExcalidrawElements). Node status colours:
waiting (grey), working (blue), done (green), problem (red).
"""
from __future__ import annotations

import threading

from . import db

_lock = threading.Lock()

STATUS_BY_EVENT = {
    "agent_started": "working",
    "agent_finished": "done",
    "agent_failed": "problem",
}


def _root_run(run_id: int) -> int:
    row = db.q1("SELECT COALESCE(parent_run_id, id) AS root FROM runs WHERE id=%s", (run_id,))
    return row["root"] if row else run_id


def on_event(ev: dict) -> None:
    links = ev.get("links") or {}
    nodes = list(links.get("map_nodes") or [])
    edges = list(links.get("map_edges") or [])
    agent = ev.get("agent", "")
    status = STATUS_BY_EVENT.get(ev.get("type", ""))
    if status and agent and agent not in ("system", "researcher", "sandbox", "github"):
        nodes.append({"id": f"agent:{agent}", "kind": "agent", "label": agent, "status": status,
                      "detail": ev.get("message", "")[:160]})
    if not nodes and not edges:
        return
    run_id = _root_run(int(ev["run_id"]))
    with _lock:
        row = db.q1("SELECT graph FROM research_maps WHERE run_id=%s", (run_id,))
        graph = row["graph"] if row else {"nodes": [], "edges": []}
        by_id = {n["id"]: n for n in graph.get("nodes", [])}
        for n in nodes:
            if "id" not in n:
                continue
            merged = {**by_id.get(n["id"], {}), **{k: v for k, v in n.items() if v is not None}}
            merged.setdefault("status", "waiting")
            by_id[n["id"]] = merged
        edge_keys = {(e["from"], e["to"], e.get("label", "")) for e in graph.get("edges", [])}
        all_edges = list(graph.get("edges", []))
        for e in edges:
            k = (e.get("from"), e.get("to"), e.get("label", ""))
            if None in k[:2] or k in edge_keys:
                continue
            edge_keys.add(k)
            all_edges.append({"from": k[0], "to": k[1], "label": k[2]})
        graph = {"nodes": list(by_id.values()), "edges": all_edges}
        db.ex("""INSERT INTO research_maps (run_id, graph, version, updated_at) VALUES (%s, %s, 1, now())
                 ON CONFLICT (run_id) DO UPDATE SET graph = EXCLUDED.graph,
                     version = research_maps.version + 1, updated_at = now()""", (run_id, db.J(graph)))


def node(id_: str, kind: str, label: str, status: str = "done", **extra) -> dict:
    return {"id": id_, "kind": kind, "label": label, "status": status, **extra}


def edge(a: str, b: str, label: str = "") -> dict:
    return {"from": a, "to": b, "label": label}
