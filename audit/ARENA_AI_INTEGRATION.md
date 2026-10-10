# Sponsor API Integration ("Arena AI")

The prompt calls it "Arena AI". **In the code it is Arina AI, served by the Elevate gateway.** The integration follows the implementation, not the name.

## As implemented (`agents/lab/llm.py`, `config.py`)
- OpenAI Chat Completions format; base `https://elevate1-0.vercel.app/api/ai`; models `gpt-5-mini` (default), `gpt-5.6-luna`, `deepseek-v4-pro`.
- Request cap 48 KB (checked before sending); output cap `ARINA_MAX_OUTPUT_TOKENS` (2500); `ARINA_REASONING_EFFORT` (low).
- Shared team token budget in Redis (`lab:arina:tokens_used`) against `ARINA_TOKEN_BUDGET` (800000); refuses to send when it would be exceeded.
- Raises `ArinaUnavailable` when unconfigured, over budget, too large, or the gateway fails.

## Where it is used
Only the **Self-Healing Debugger** (`healer.diagnose`). Order: memory, known pattern, cache, Arina, then (on `ArinaUnavailable`) the existing Groq/Gemini chain as `fallback_ai`. The source is recorded per diagnosis (`arina`, `fallback_ai`, ...). Research, planning and the Gap Explorer do **not** use it.

## Configuration
`.env.example` lists `ARINA_API_KEY` (alias `ELEVATE_TEAM_API_KEY`), `ARINA_BASE_URL`, `ARINA_MODEL`, `ARINA_MAX_OUTPUT_TOKENS`, `ARINA_REASONING_EFFORT`, `ARINA_TOKEN_BUDGET`. The local `.env` has **no `ARINA_API_KEY`**, so `arina_available()` is False.

## Status: NOT VERIFIED LIVE
No key was available, so no real gateway call was made. Verified only: `llm.py` and `healer.py` import and compile, and `arina_available()` returns False without a key (the healer then falls back). Do not claim sponsor-API usage in a demo until a key is set and a heal session has actually run.
