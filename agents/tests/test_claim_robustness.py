"""A model may return null or the wrong type for any claim field; saving a claim must never fail because of that."""
from lab import research


def params(c, **kw):
    return research.claim_params(7, c, 71.3, kw.get("page"), kw.get("pos"), kw.get("found", ""), kw.get("quotes", [""]), kw.get("verified", True))


def test_null_text_fields_become_empty_strings_not_nulls():
    p = params({"metric_name": None, "description": "test accuracy with warmup", "unit": None, "table_ref": None, "condition": None, "quote": None})
    paper_id, metric, desc, value, unit, higher, tol, page, table_ref, pos, condition, quote = p
    assert (unit, table_ref, condition, quote) == ("", "", "", "") and metric == "test_accuracy_with_warmup" and desc == "test accuracy with warmup"
    assert all(x is not None for x in (metric, desc, unit, table_ref, condition, quote))  # the columns are NOT NULL


def test_page_numbers_given_as_text_are_understood_and_unknown_pages_stay_null():
    assert params({"description": "d", "page": "p. 4"})[7] == 4
    assert params({"description": "d", "page": 3.0})[7] == 3
    assert params({"description": "d", "page": None})[7] is None
    assert params({"description": "d", "page": "n/a"})[7] is None
    assert params({"description": "d", "page": 5}, page=2)[7] == 2  # the located page in the paper wins over the model's guess


def test_bad_tolerance_and_booleans_fall_back_safely():
    assert params({"description": "d", "tolerance": None})[6] == 0.10 and params({"description": "d", "tolerance": "abc"})[6] == 0.10
    assert params({"description": "d", "tolerance": 0.05})[6] == 0.05
    assert params({"description": "d", "higher_is_better": True})[5] is True and params({"description": "d", "higher_is_better": "true"})[5] is True
    assert params({"description": "d", "higher_is_better": None})[5] is False


def test_the_found_quote_wins_and_unverified_claims_are_marked():
    p = params({"description": "d", "condition": "CIFAR-10"}, found="reaches a test accuracy of 71.3%", quotes=["71.3%"], verified=False)
    assert p[11] == "reaches a test accuracy of 71.3%" and p[10].startswith("CIFAR-10") and "not verified" in p[10]
    assert params({"description": "d"}, found="", quotes=["71.3%"])[11] == "71.3%"
