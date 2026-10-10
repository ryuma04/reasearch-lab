"""Better-resource recommendations: discovery, comparison, honest failure reporting and the planner hand-off (providers mocked)."""
import copy
from datetime import datetime, timedelta, timezone

import pytest

from lab import planner, resources, sources as cs

OBJECTIVE = {"papers": [{"paper_id": 1, "title": "Cattle breed classification with convolutional networks", "summary": "We classify cow and cattle breeds from images using convolutional networks.",
                         "claims": [{"description": "cattle breed classification accuracy", "value": 90, "unit": "%"}], "field": "computer vision"}], "sources": {}}


def iso(years_ago):
    return (datetime.now(timezone.utc) - timedelta(days=365 * years_ago)).isoformat().replace("+00:00", "Z")


def hf_ds(hid, desc, tags=(), lic="cc-by-4.0", years=0.5, files=("README.md",)):
    return {"id": hid, "description": desc, "tags": [f"license:{lic}", "task_categories:image-classification", *tags], "downloads": 100, "likes": 3,
            "lastModified": iso(years), "siblings": [{"rfilename": f} for f in files]}


LONG = "A large labelled collection of cattle and cow photographs across many breeds, with train and test splits and annotation notes. " * 3
ORIGINAL = {"name": "cow-photos", "url": "https://huggingface.co/datasets/me/cow-photos", "user_provided": True}


class World:
    """Fake provider responses keyed by URL; a value of None simulates a failed request."""

    def __init__(self, search=None, details=None, fail_search=False):
        self.search, self.details, self.fail_search = search or [], details or {}, fail_search

    def json(self, f, url, params=None):
        if url.endswith("/api/datasets"):
            if self.fail_search:
                f.limits.append("huggingface.co answered 503")
                return None
            return [{"id": h} for h in self.search]
        if "/api/datasets/" in url:
            return self.details.get(url.split("/api/datasets/")[1])
        return None


@pytest.fixture
def world(monkeypatch):
    w = World()
    monkeypatch.setattr(cs.Fetch, "json", lambda self, url, params=None: w.json(self, url, params))
    monkeypatch.setattr(resources, "_kaggle_auth", lambda: None)
    return w


def run(sources_datasets=(ORIGINAL,), code=None, note=""):
    return resources.build(copy.deepcopy(OBJECTIVE), {"datasets": [dict(d) for d in sources_datasets], "repositories": []}, code, note)


def cats(res):
    return {r["name"]: r["category"] for r in res["recommendations"]}


def test_a_clearly_better_dataset_is_recommended_and_the_original_is_kept(world):
    world.details = {"me/cow-photos": hf_ds("me/cow-photos", "cows", tags=["x"], lic="none", years=6, files=()),
                     "org/cattle-breeds": hf_ds("org/cattle-breeds", LONG, tags=["size_categories:10K<n<100K"], years=0.3)}
    world.search = ["org/cattle-breeds"]
    res = run()
    r = res["recommendations"][0]
    assert r["category"] == "better_alternative" and r["name"] == "org/cattle-breeds" and r["original"]["name"] == "cow-photos"
    assert r["advantages"] and r["evidence"] and r["url"].startswith("https://huggingface.co/datasets/")
    assert res["status"] in ("completed", "partial") and "original resources are kept" in res["note"]


def test_several_alternatives_are_all_listed_with_their_own_category(world):
    world.details = {"me/cow-photos": hf_ds("me/cow-photos", "cows", lic="none", years=6, files=()),
                     "a/cattle-a": hf_ds("a/cattle-a", LONG, tags=["size_categories:1K<n<10K"]),
                     "b/cow-b": hf_ds("b/cow-b", LONG, tags=["size_categories:1K<n<10K"], years=1.5),
                     "c/other": hf_ds("c/other", "Random unrelated tabular data about weather stations and rainfall measurements " * 3)}
    world.search = ["a/cattle-a", "b/cow-b", "c/other"]
    res = run()
    c = cats(res)
    assert c["a/cattle-a"] == "better_alternative" and "b/cow-b" in c and "c/other" not in c  # irrelevant candidates are dropped
    assert len([r for r in res["recommendations"] if r["category"] == "better_alternative"]) >= 1


def test_a_relevant_candidate_that_is_not_better_is_not_recommended(world):
    strong = hf_ds("me/cow-photos", LONG, tags=["size_categories:10K<n<100K"], years=0.2)
    weak = hf_ds("x/cow-small", "cow images small set " * 4, lic="none", years=5, files=())
    world.details, world.search = {"me/cow-photos": strong, "x/cow-small": weak}, ["x/cow-small"]
    assert cats(run())["x/cow-small"] == "not_better"


def test_unscored_original_means_no_alternative_can_be_called_better(world):
    world.details = {"org/cattle-breeds": hf_ds("org/cattle-breeds", LONG, tags=["size_categories:10K<n<100K"])}
    world.search = ["org/cattle-breeds"]
    res = run(sources_datasets=({"name": "my upload.zip", "user_provided": True},))  # an uploaded file: no metadata to compare
    assert cats(res)["org/cattle-breeds"] in ("possible_needs_validation", "relevant_alternative")
    assert "better_alternative" not in cats(res).values()


def test_no_results_is_reported_as_no_alternative_found_not_as_a_failure(world):
    res = run()
    assert res["status"] == "completed" and res["recommendations"] == [] and res["note"].startswith("No alternative was found")


def test_a_failing_provider_is_reported_as_failed_not_as_nothing_found(world):
    world.fail_search = True
    res = run()
    assert res["status"] == "failed" and "could not be completed" in res["note"] and "No alternative was found" not in res["note"]
    assert any(p["name"] == "huggingface" and p["status"] == "failed" for p in res["providers"])
    assert res["limitations"]


def test_malformed_metadata_and_inaccessible_candidates_are_handled(world):
    world.details = {"bad/one": None, "odd/two": {"id": "odd/two", "tags": None, "cardData": None, "siblings": None, "description": None}}
    world.search = ["bad/one", "odd/two"]
    res = run(sources_datasets=())
    assert cats(res).get("bad/one") in (None, "inaccessible")
    assert "better_alternative" not in cats(res).values()


def test_duplicates_are_removed(world):
    world.details = {"org/cattle-breeds": hf_ds("org/cattle-breeds", LONG)}
    world.search = ["org/cattle-breeds", "Org/Cattle-Breeds"]
    assert len([r for r in run(sources_datasets=()).get("recommendations", []) if "attle" in r["name"]]) == 1


def test_insufficient_evidence_never_claims_superiority():
    orig = resources.evaluate_dataset({"fetched": True, "name": "o", "description": "x", "tags": [], "files": [], "licence": "none"}, ["cattle"])
    cand = resources.evaluate_dataset({"fetched": True, "name": "cattle set", "description": "cattle", "tags": [], "files": [], "licence": "mit", "updated": iso(0.1)}, ["cattle"])
    cat, *_ = resources.classify(orig, cand)
    assert cat != "better_alternative"


def test_repository_recommendations_use_the_assessment_and_keep_ids_stable():
    code = {"verdict": "better_alternative", "summary": "alt is ahead", "confidence": "high", "advantages": ["Docs"], "tradeoffs": [],
            "original": [{"name": "me/repo", "url": "https://github.com/me/repo", "fetched": True, "score": 40}],
            "recommended": {"url": "https://github.com/x/better"},
            "alternatives": [{"url": "https://github.com/x/better", "name": "x/better", "host": "github", "fetched": True, "score": 80, "mentions_paper": True, "criteria": []},
                             {"url": "https://github.com/y/weak", "name": "y/weak", "host": "github", "fetched": True, "score": 20, "mentions_paper": True, "criteria": []}],
            "providers": [{"name": "github", "status": "ok"}]}
    recs = resources.from_code_assessment(code)
    assert {r["name"]: r["category"] for r in recs} == {"x/better": "better_alternative", "y/weak": "not_better"}
    assert recs[0]["id"] == resources.rec_id("repository", "https://github.com/x/better/")  # trailing slash does not change identity


def test_repository_search_failure_is_search_failed_not_no_alternative():
    r = cs.decide(None, [], ["github down"], search_ok=False)
    assert r["verdict"] == "search_failed"
    assert cs.decide(None, [], [], search_ok=True)["verdict"] == "no_alternative_found"


# ---------- planner receives the decisions ----------

def decisions(kind="accept"):
    return [{"rec_id": "rec-1", "decision": kind, "note": "", "name": "org/cattle-breeds", "url": "https://huggingface.co/datasets/org/cattle-breeds",
             "kind": "dataset", "category": "better_alternative", "original": "cow-photos"}]


def test_template_plan_uses_an_accepted_resource_and_validates():
    reqs = planner.requirements_from(OBJECTIVE)
    plan = planner.template_plan(OBJECTIVE, reqs, decisions("accept"))
    assert "org/cattle-breeds" in plan["tasks"][1]["description"]
    assert planner.validate(plan, [r["id"] for r in reqs], decisions("accept"))["ok"]


def test_a_plan_that_ignores_an_accepted_resource_fails_validation():
    reqs = planner.requirements_from(OBJECTIVE)
    plan = planner.template_plan(OBJECTIVE, reqs)  # built without the decision
    v = planner.validate(plan, [r["id"] for r in reqs], decisions("accept"))
    assert not v["ok"] and "org/cattle-breeds" in " ".join(v["errors"])


def test_rejected_resources_are_not_reselected_and_keep_original_adds_no_requirement():
    reqs = planner.requirements_from(OBJECTIVE)
    plan = planner.template_plan(OBJECTIVE, reqs, decisions("reject"))
    assert "rejected by the researcher" in plan["tasks"][1]["description"]
    assert planner.validate(plan, [r["id"] for r in reqs], decisions("reject"))["ok"]
    assert planner.validate(planner.template_plan(OBJECTIVE, reqs), [r["id"] for r in reqs], decisions("keep_original"))["ok"]


def test_supplement_is_used_as_a_supplement_not_a_replacement():
    reqs = planner.requirements_from(OBJECTIVE)
    plan = planner.template_plan(OBJECTIVE, reqs, decisions("supplement"))
    assert "supplement" in plan["tasks"][1]["description"] and "cow-photos" in plan["tasks"][1]["description"]
