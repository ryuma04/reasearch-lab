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
    groq_api_keys: tuple
    gemini_api_keys: tuple
    gemini_models: tuple
    model_planner: str
    model_reviewer: str
    model_writer: str
    model_fast: str
    model_gemini: str

    # Automatic Debugger repairs after the first failed run (each repair re-runs in a new container).
    max_repair_attempts: int = 3

    # Arina AI (Elevate gateway, OpenAI Chat Completions format): used only by the Self-Healing Debugger.
    arina_api_key: str = ""
    arina_base_url: str = "https://elevate1-0.vercel.app/api/ai"
    arina_model: str = "gpt-5-mini"
    arina_max_output_tokens: int = 2500
    arina_reasoning_effort: str = "low"
    arina_token_budget: int = 800_000
    arina_max_output_tokens_code: int = 6000   # coding writes whole files, so it may use more output than a debugging diagnosis
    arina_fallback_shared: bool = False        # explicit opt-in: let Groq/Gemini answer for Arina agents when Arina fails

    # Provider requests, shared by every agent.
    ai_timeout: int = 180                      # seconds to wait for a model answer
    ai_max_retries: int = 3                    # bounded attempts per call (rate-limit waits and transient backoff)
    ai_backoff: float = 2.0                    # seconds, doubled per transient retry
    ai_per_key_concurrency: int = 2            # requests in flight on one key

    # Hugging Face Hub publishing (official huggingface_hub client). Never logged.
    hf_token: str = ""


def _keys(list_var: str, single_var: str) -> tuple:
    """Several API keys (comma separated) for rotation; falls back to the single-key variable."""
    raw = _get(list_var) or _get(single_var)
    seen, out = set(), []
    for k in (x.strip() for x in raw.split(",")):
        if k and k not in seen:
            seen.add(k)
            out.append(k)
    return tuple(out)


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
        groq_api_key=(_keys("GROQ_API_KEYS", "GROQ_API_KEY") or ("",))[0],
        gemini_api_key=(_keys("GEMINI_API_KEYS", "GEMINI_API_KEY") or ("",))[0],
        groq_api_keys=_keys("GROQ_API_KEYS", "GROQ_API_KEY"),
        gemini_api_keys=_keys("GEMINI_API_KEYS", "GEMINI_API_KEY"),
        gemini_models=tuple(m.strip() for m in _get("GEMINI_MODELS", _get("GEMINI_MODEL", "gemini-3-flash-preview")).split(",") if m.strip()),
        openrouter_api_key=_get("OPENROUTER_API_KEY"),
        model_planner=_get("GROQ_MODEL_PLANNER", "openai/gpt-oss-120b"),
        model_reviewer=_get("GROQ_MODEL_REVIEWER", "qwen/qwen3.8-27b"),
        model_writer=_get("GROQ_MODEL_WRITER", "openai/gpt-oss-20b"),
        model_fast=_get("GROQ_MODEL_FAST", "openai/gpt-oss-20b"),
        model_gemini=_get("GEMINI_MODELS", _get("GEMINI_MODEL", "gemini-3-flash-preview")).split(",")[0].strip(),
        max_repair_attempts=int(_get("MAX_REPAIR_ATTEMPTS", "3")),
        arina_api_key=_get("ARINA_API_KEY", _get("ARENA_API_KEY", _get("ELEVATE_TEAM_API_KEY"))),
        arina_base_url=_get("ARINA_BASE_URL", _get("ARENA_BASE_URL", "https://elevate1-0.vercel.app/api/ai")).rstrip("/"),
        arina_model=_get("ARINA_MODEL", _get("ARENA_MODEL", "gpt-5-mini")),
        arina_max_output_tokens=int(_get("ARINA_MAX_OUTPUT_TOKENS", "2500")),
        arina_reasoning_effort=_get("ARINA_REASONING_EFFORT", "low"),
        arina_token_budget=int(_get("ARINA_TOKEN_BUDGET", "800000")),
        arina_max_output_tokens_code=int(_get("ARINA_MAX_OUTPUT_TOKENS_CODE", "6000")),
        arina_fallback_shared=_get("ARINA_FALLBACK_TO_SHARED", "false").lower() in ("1", "true", "yes"),
        ai_timeout=int(_get("AI_REQUEST_TIMEOUT_SECONDS", "180")),
        ai_max_retries=int(_get("AI_MAX_RETRIES", "3")),
        ai_backoff=float(_get("AI_RETRY_BACKOFF_SECONDS", "2")),
        ai_per_key_concurrency=int(_get("AI_MAX_CONCURRENCY_PER_KEY", "2")),
        hf_token=_get("HF_TOKEN"),
    )


settings = load()


def project_dir(workspace_id: int, run_id: int) -> Path:
    """Same layout as the Go sandbox (sandbox.ProjectRel)."""
    return settings.data_dir / "workspaces" / str(workspace_id) / "runs" / str(run_id) / "project"
