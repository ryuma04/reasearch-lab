"""Hugging Face publishing with a fake Hub API: no network, nothing is created on Hugging Face."""
import hashlib
import os
import re
import sys

import pytest
import requests
from huggingface_hub.utils import HfHubHTTPError

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lab import bus, hfpublish  # noqa: E402
from lab.config import settings  # noqa: E402


def http_error(code):
    resp = requests.Response()
    resp.status_code = code
    return HfHubHTTPError(f"{code} Client Error", response=resp)


class FakeHub:
    """Records every call; `fail` maps a method name to a list of exceptions to raise first."""

    def __init__(self, fail=None, listed=None):
        self.calls, self.fail, self.listed, self.uploaded = [], fail or {}, listed, {}

    def _maybe_fail(self, name):
        errs = self.fail.get(name)
        if errs:
            raise errs.pop(0)

    def whoami(self):
        self.calls.append("whoami")
        self._maybe_fail("whoami")
        return {"name": "Ryuma04"}

    def create_repo(self, repo_id, repo_type, private, exist_ok):
        self.calls.append(("create_repo", repo_id, private, exist_ok))
        self._maybe_fail("create_repo")
        return f"https://huggingface.co/{repo_id}"

    def update_repo_settings(self, repo_id, private, repo_type):
        self.calls.append(("visibility", private))

    def preupload_lfs_files(self, repo_id, additions, repo_type):
        self.calls.append(("preupload", additions[0].path_in_repo))
        self._maybe_fail("preupload")

    def create_commit(self, repo_id, operations, repo_type, commit_message):
        self.calls.append(("commit", [o.path_in_repo for o in operations]))
        self._maybe_fail("create_commit")
        for o in operations:
            data = o.path_or_fileobj
            self.uploaded[o.path_in_repo] = data if isinstance(data, bytes) else open(data, "rb").read()

        class Info:
            oid = "abc123"
            commit_url = f"https://huggingface.co/{repo_id}/commit/abc123"
        return Info()

    def list_repo_files(self, repo_id, revision, repo_type):
        self.calls.append(("list", revision))
        return self.listed if self.listed is not None else list(self.uploaded)


class FakeDB:
    def __init__(self, row):
        self.row = row

    def q1(self, sql, args):
        return dict(self.row)

    def ex(self, sql, args):
        cols = re.findall(r"(\w+)=%s", sql.split("WHERE")[0])
        self.row.update(dict(zip(cols, args)))


@pytest.fixture
def env(tmp_path, monkeypatch):
    root = tmp_path / "project"
    (root / "models").mkdir(parents=True)
    (root / "results").mkdir()
    (root / "configs").mkdir()
    files = {"models/clf.joblib": b"\x80\x04model-bytes" * 100, "results/metrics.json": b'{"metrics": {"acc": 0.95}}',
             "configs/config.yaml": b"seed: 0\n"}
    manifest = []
    for rel, data in files.items():
        (root / rel).write_bytes(data)
        manifest.append({"path": rel, "size": len(data), "sha256": hashlib.sha256(data).hexdigest(), "kind": "x"})
    row = {"id": 1, "run_id": 33, "status": "queued", "repo_name": "digits-run-33", "private": True, "files": manifest,
           "model_card": "# digits-run-33\n\nmeasured acc 0.95\n"}
    fdb = FakeDB(row)
    monkeypatch.setattr(hfpublish, "db", fdb)
    monkeypatch.setattr(hfpublish, "pdir", lambda run_id: root)
    monkeypatch.setattr(bus, "emit", lambda *a, **k: None)
    monkeypatch.setattr(settings.__class__, "__setattr__", object.__setattr__, raising=False)
    old = settings.hf_token
    object.__setattr__(settings, "hf_token", "hf_testtoken_not_real")
    yield {"root": root, "row": fdb.row, "files": files}
    object.__setattr__(settings, "hf_token", old)


def run(api, sleeps=None):
    return hfpublish.publish(1, api=api, sleep=lambda s: sleeps.append(s) if sleeps is not None else None)


def test_creates_private_repo_uploads_real_files_and_confirms(env):
    hub = FakeHub()
    out = run(hub)
    assert out["status"] == "succeeded"
    row = env["row"]
    assert row["status"] == "succeeded" and row["repo_id"] == "Ryuma04/digits-run-33"
    assert row["repo_url"] == "https://huggingface.co/Ryuma04/digits-run-33" and row["commit_sha"] == "abc123"
    assert ("create_repo", "Ryuma04/digits-run-33", True, True) in hub.calls and ("visibility", True) in hub.calls
    # every file goes through the large-file step, then one commit with the model card
    assert [c[1] for c in hub.calls if c[0] == "preupload"] == list(env["files"])
    commits = [c for c in hub.calls if c[0] == "commit"]
    assert len(commits) == 1 and commits[0][1][-1] == "README.md"
    assert hub.uploaded["models/clf.joblib"] == env["files"]["models/clf.joblib"]  # the actual weights
    assert b"measured acc 0.95" in hub.uploaded["README.md"]
    assert row["files_done"] == 4 and ("list", "abc123") in hub.calls


def test_owner_in_repo_name_is_kept(env):
    env["row"]["repo_name"] = "my-lab/digits"
    hub = FakeHub()
    run(hub)
    assert env["row"]["repo_id"] == "my-lab/digits"


def test_authentication_failure_stops_before_creating_anything(env):
    hub = FakeHub(fail={"whoami": [http_error(401)]})
    out = run(hub)
    assert out["status"] == "failed" and "rejected the access token" in env["row"]["error"]
    assert not any(isinstance(c, tuple) and c[0] == "create_repo" for c in hub.calls)
    assert "hf_testtoken_not_real" not in env["row"]["error"]  # the token never appears in messages


def test_permission_error_is_explained(env):
    hub = FakeHub(fail={"create_repo": [http_error(403)]})
    run(hub)
    assert env["row"]["status"] == "failed" and "write" in env["row"]["error"]


def test_changed_or_missing_file_is_rejected_before_any_hub_call(env):
    (env["root"] / "models" / "clf.joblib").write_bytes(b"swapped after confirmation")
    hub = FakeHub()
    out = run(hub)
    assert out["status"] == "failed" and "changed after you confirmed" in env["row"]["error"] and hub.calls == []
    os.remove(env["root"] / "models" / "clf.joblib")
    env["row"]["status"] = "queued"
    run(hub)
    assert "missing" in env["row"]["error"] and hub.calls == []


def test_symlinked_file_is_rejected(env, tmp_path):
    target = tmp_path / "host_secret"
    target.write_bytes(b"secret")
    p = env["root"] / "configs" / "config.yaml"
    p.unlink()
    try:
        os.symlink(target, p)
    except OSError:
        pytest.skip("symlinks not available")
    out = run(FakeHub())
    assert out["status"] == "failed"


def test_transient_errors_are_retried_with_backoff(env):
    hub = FakeHub(fail={"preupload": [requests.ConnectionError("reset"), http_error(503)],
                        "create_commit": [http_error(429)]})
    sleeps = []
    out = run(hub, sleeps)
    assert out["status"] == "succeeded"
    assert sleeps == [2.0, 4.0, 2.0]  # two retries for the upload, one for the commit
    assert len([c for c in hub.calls if c[0] == "commit"]) == 2


def test_network_failure_after_three_tries_fails_clearly(env):
    hub = FakeHub(fail={"create_commit": [requests.ConnectionError("down")] * 3})
    out = run(hub, [])
    assert out["status"] == "failed" and "after 3 tries" in env["row"]["error"]
    assert env["row"].get("repo_url") in ("", None)  # no link is shown for an upload the Hub did not confirm


def test_success_needs_the_hub_to_list_the_files(env):
    hub = FakeHub(listed=["README.md", "results/metrics.json"])
    out = run(hub)
    assert out["status"] == "failed" and "did not list" in env["row"]["error"] and "models/clf.joblib" in env["row"]["error"]


def test_missing_token(env):
    object.__setattr__(settings, "hf_token", "")
    hub = FakeHub()
    assert run(hub)["status"] == "failed" and "HF_TOKEN" in env["row"]["error"] and hub.calls == []
