"""Publish a run's verified model to the Hugging Face Hub with the official huggingface_hub client.

The Go API fixed the file manifest (path, size, sha256) and the model card when the researcher
confirmed. This worker re-checks every file against that manifest, creates or updates the
repository, uploads large files first (LFS, one at a time so progress is real), then makes a
single commit with everything. Success is recorded only after the Hub returns the commit and the
uploaded files are listed in the repository at that commit. The token is never logged or stored.
"""
from __future__ import annotations

import hashlib
import logging
import time
from pathlib import Path

from . import bus, db
from .config import settings
from .project import pdir, safe_rel, safe_target

log = logging.getLogger("lab.hfpublish")

RETRIES = 3
BACKOFF = 2.0  # seconds, doubled per retry
HUB = "https://huggingface.co"


class PublishError(Exception):
    """A failure with a message the researcher can act on."""


def _api():
    from huggingface_hub import HfApi
    return HfApi(token=settings.hf_token or None)


def _status_of(e: Exception) -> int | None:
    resp = getattr(e, "response", None)
    return getattr(resp, "status_code", None)


def _transient(e: Exception) -> bool:
    """Network problems and Hub 5xx/429 are retried; auth, permission and bad requests are not."""
    import requests
    if isinstance(e, (requests.ConnectionError, requests.Timeout, ConnectionError, TimeoutError)):
        return True
    code = _status_of(e)
    return code is not None and (code >= 500 or code == 429)


def _friendly(e: Exception, action: str) -> str:
    code = _status_of(e)
    if code == 401:
        return "Hugging Face rejected the access token (HF_TOKEN). Create a new token with write access and update .env."
    if code == 403:
        return f"The access token is not allowed to {action}. It needs the 'write' role (and access to the chosen owner)."
    if code == 409:
        return f"Hugging Face reported a conflict while trying to {action}: {_short(e)}"
    if code == 404:
        return f"Hugging Face could not find what was needed to {action}: {_short(e)}"
    if _transient(e):
        return f"Could not reach Hugging Face to {action} after {RETRIES} tries (network or server problem). Try again later."
    return f"Could not {action}: {_short(e)}"


def _short(e: Exception) -> str:
    msg = str(e).replace(settings.hf_token, "***") if settings.hf_token else str(e)
    return msg.splitlines()[0][:300] if msg else type(e).__name__


def retry(fn, action: str, sleep=time.sleep):
    """Call fn, retrying transient failures with backoff. Raises PublishError with a clear message."""
    for attempt in range(1, RETRIES + 1):
        try:
            return fn()
        except PublishError:
            raise
        except Exception as e:  # noqa: BLE001
            if _transient(e) and attempt < RETRIES:
                log.warning("hugging face: %s failed (attempt %d), retrying: %s", action, attempt, _short(e))
                sleep(BACKOFF * 2 ** (attempt - 1))
                continue
            raise PublishError(_friendly(e, action)) from e
    raise PublishError(f"Could not {action}")  # unreachable


def _update(pub_id: int, **cols) -> None:
    sets = ", ".join(f"{k}=%s" for k in cols)
    db.ex(f"UPDATE hf_publications SET {sets} WHERE id=%s", (*cols.values(), pub_id))


def _sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def verify_files(root: Path, files: list[dict]) -> list[tuple[str, Path, int]]:
    """Every file must still be exactly what the researcher confirmed."""
    out = []
    for f in files:
        rel = safe_rel(f.get("path", ""))
        p = safe_target(root, rel) if rel else None
        if p is None or not p.is_file():
            raise PublishError(f"{f.get('path')} is missing or is no longer a regular file; open the preview again")
        size = p.stat().st_size
        if size != f.get("size") or _sha256(p) != f.get("sha256"):
            raise PublishError(f"{rel} changed after you confirmed; open the preview again and confirm the new files")
        out.append((rel, p, size))
    return out


def publish(pub_id: int, api=None, sleep=time.sleep) -> dict:
    """Run one publication. Returns {"status": ..., ...}; the row holds the details for the UI."""
    from huggingface_hub import CommitOperationAdd

    row = db.q1("SELECT * FROM hf_publications WHERE id=%s", (pub_id,))
    if not row or row["status"] != "queued":
        return {"status": "skipped"}
    run_id = row["run_id"]
    _update(pub_id, status="uploading", stage="checking files")
    try:
        if not settings.hf_token:
            raise PublishError("HF_TOKEN is not set for the agent worker; add it to .env and restart.")
        api = api or _api()
        files = verify_files(pdir(run_id), row["files"] or [])

        _update(pub_id, stage="checking the access token")
        who = retry(lambda: api.whoami(), "check the access token", sleep)
        name = row["repo_name"]
        repo_id = name if "/" in name else f"{who['name']}/{name}"
        _update(pub_id, repo_id=repo_id, stage="creating the repository")
        url = retry(lambda: api.create_repo(repo_id, repo_type="model", private=row["private"], exist_ok=True),
                    "create the repository", sleep)
        # An existing repository keeps nothing hidden: apply the visibility the researcher chose.
        retry(lambda: api.update_repo_settings(repo_id, private=row["private"], repo_type="model"),
              "set the repository visibility", sleep)
        repo_url = str(url) if url else f"{HUB}/{repo_id}"

        ops = []
        done_bytes = 0
        for i, (rel, path, size) in enumerate(files, start=1):
            _update(pub_id, stage=f"uploading {rel}")
            op = CommitOperationAdd(path_in_repo=rel, path_or_fileobj=str(path))
            # Large files go to LFS storage now (small ones travel inside the commit below).
            retry(lambda op=op: api.preupload_lfs_files(repo_id, additions=[op], repo_type="model"), f"upload {rel}", sleep)
            ops.append(op)
            done_bytes += size
            _update(pub_id, files_done=i, bytes_done=done_bytes)
        card = (row["model_card"] or "").encode()
        ops.append(CommitOperationAdd(path_in_repo="README.md", path_or_fileobj=card))

        _update(pub_id, stage="committing")
        info = retry(lambda: api.create_commit(repo_id, operations=ops, repo_type="model",
                                               commit_message=f"Research Lab run {run_id}: model, metrics and model card"),
                     "commit the files", sleep)
        sha = getattr(info, "oid", "") or ""
        commit_url = getattr(info, "commit_url", "") or ""

        _update(pub_id, stage="confirming on Hugging Face")
        listed = set(retry(lambda: api.list_repo_files(repo_id, revision=sha or None, repo_type="model"),
                           "confirm the upload", sleep))
        missing = [rel for rel, _, _ in files if rel not in listed] + ([] if "README.md" in listed else ["README.md"])
        if missing:
            raise PublishError("Hugging Face did not list these files after the commit: " + ", ".join(missing))
        _update(pub_id, status="succeeded", stage="done", files_done=len(files) + 1, bytes_done=done_bytes + len(card),
                repo_url=repo_url, commit_url=commit_url, commit_sha=sha, finished_at=_now())
        bus.emit(run_id, "publisher", "hf_published", f"Published to Hugging Face: {repo_url}",
                 "Hugging Face confirmed the commit and listed every file", {"repo_url": repo_url, "commit": sha})
        return {"status": "succeeded", "repo_url": repo_url, "commit": sha}
    except PublishError as e:
        _update(pub_id, status="failed", stage="failed", error=str(e)[:2000], finished_at=_now())
        bus.emit(run_id, "publisher", "hf_publish_failed", "Publishing to Hugging Face failed", str(e)[:300])
        return {"status": "failed", "error": str(e)}
    except Exception as e:  # noqa: BLE001
        log.exception("hf publication %s failed", pub_id)
        _update(pub_id, status="failed", stage="failed", error=f"Unexpected error: {_short(e)}", finished_at=_now())
        return {"status": "failed", "error": _short(e)}


def _now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc)
