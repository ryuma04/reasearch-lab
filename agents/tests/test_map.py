from lab import research


BRIEF = {
    "papers": [{"paper_id": 5, "title": "Distilling the Knowledge", "arxiv_id": "1503.02531v1", "claims": [
        {"id": 9, "description": "Small net distilled", "value": 74.0, "page": 4}]}],
    "sources": {
        "datasets": [{"name": "MNIST", "url": "https://pytorch.org/vision/x", "official": True},
                     {"name": "upload.csv", "url": "workspaces/1/uploads/a.csv", "user_provided": True}],
        "repositories": [{"url": "https://github.com/a/b", "name": "a/b", "user_provided": True},
                         {"url": "https://github.com/c/d", "name": "c/d", "official": False}],
        "related_papers": [{"title": "Born-Again Networks", "year": 2018, "citations": 900, "arxiv": "1805.04770"},
                           {"title": "No arxiv id", "year": 2020, "citations": 3, "arxiv": None}],
        "recommendation": "x"},
}


def test_every_source_node_has_a_connection_and_only_real_urls():
    nodes, edges = research.map_for_brief(BRIEF)
    by = {n["id"]: n for n in nodes}
    ids = set(by)
    assert all(e["from"] in ids and e["to"] in ids for e in edges), "edges must reference existing nodes"
    linked = {e["from"] for e in edges} | {e["to"] for e in edges}
    assert {"repo:0", "repo:1", "dataset:0", "related:0", "related:1"} <= linked
    assert by["paper:5"]["url"] == "https://arxiv.org/abs/1503.02531"
    assert by["related:0"]["url"] == "https://arxiv.org/abs/1805.04770"
    assert by["related:1"]["url"] is None, "never guess a URL"
    assert by["dataset:1"]["url"] is None, "a local upload path is not a web link"
    labels = {(e["from"], e["label"]) for e in edges}
    assert ("repo:0", "code provided by you for") in labels
    assert ("repo:1", "found by title search, not confirmed:") in labels
    assert ("related:0", "cites") in labels


def test_edges_are_unique():
    _, edges = research.map_for_brief(BRIEF)
    keys = [(e["from"], e["to"], e["label"]) for e in edges]
    assert len(keys) == len(set(keys))
