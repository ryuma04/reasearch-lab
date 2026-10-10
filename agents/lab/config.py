"""Settings from environment variables (and the repository's .env file)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _load_dotenv() -> Path | None:
    here = Path.cwd()
    for d in [here, *here.parents][:5]:
        f = d / ".env"
        if f.is_file():
            for line in f.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k, v = k.strip(), v.strip().strip("'\"")
                if k and k not in os.environ:
                    os.environ[k] = v
            return d
    return None


_ENV_DIR = _load_dotenv()


def _get(key: str, default: str = "") -> str:
    v = os.environ.get(key, "")
    return v if v else default


@dataclass(frozen=True)
class Settings:
    database_url: str
    redis_url: str
    data_dir: Path
    api_url: str
    internal_token: str
    port: int
    concurrency: int

    groq_api_key: str
    gemini_api_key: str
    openrouter_api_key: str
    model_planner: str
    model_reviewer: str
    model_writer: str
    model_fast: str
    model_gemini: str

    max_repair_attempts: int = 5


def load() -> Settings:
    data_dir = Path(_get("DATA_DIR", "./data"))
    if not data_dir.is_absolute() and _ENV_DIR is not None:
        data_dir = _ENV_DIR / data_dir
    data_dir = data_dir.resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    return Settings(
        database_url=_get("DATABASE_URL", "postgres://lab:lab@localhost:5433/lab?sslmode=disable"),
        redis_url=_get("REDIS_URL", "redis://localhost:6379/0"),
        data_dir=data_dir,
        api_url=_get("API_INTERNAL_URL", "http://localhost:8080").rstrip("/"),
        internal_token=_get("INTERNAL_TOKEN", ""),
        port=int(_get("AGENTS_PORT", "8001")),
        concurrency=int(_get("WORKER_CONCURRENCY", "3")),
        groq_api_key=_get("GROQ_API_KEY"),
        gemini_api_key=_get("GEMINI_API_KEY"),
        openrouter_api_key=_get("OPENROUTER_API_KEY"),
        model_planner=_get("GROQ_MODEL_PLANNER", "openai/gpt-oss-120b"),
        model_reviewer=_get("GROQ_MODEL_REVIEWER", "qwen/qwen3-32b"),
        model_writer=_get("GROQ_MODEL_WRITER", "llama-3.3-70b-versatile"),
        model_fast=_get("GROQ_MODEL_FAST", "llama-3.1-8b-instant"),
        model_gemini=_get("GEMINI_MODEL", "gemini-2.5-flash"),
        max_repair_attempts=int(_get("MAX_REPAIR_ATTEMPTS", "5")),
    )


settings = load()


def project_dir(workspace_id: int, run_id: int) -> Path:
    """Same layout as the Go sandbox (sandbox.ProjectRel)."""
    return settings.data_dir / "workspaces" / str(workspace_id) / "runs" / str(run_id) / "project"
