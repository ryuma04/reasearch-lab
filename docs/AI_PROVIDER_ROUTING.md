# AI provider routing

Every model call goes through `agents/lab/llm.py`. The registry `AGENTS` there is the one place that says which agent talks to which provider.

| Agent id | What it does | Provider | Model | Keys it uses |
|---|---|---|---|---|
| `research_a` | Paper Reader: claims, settings, summary | Groq | `GROQ_MODEL_PLANNER` | `GROQ_RESEARCH_A_KEY_1/2` |
| `research_b` | Research Gap Explorer: extraction, comparison, gaps, recommendations | Groq | `GROQ_MODEL_PLANNER` / `GROQ_MODEL_FAST` role | `GROQ_RESEARCH_B_KEY_1/2` |
| `planning_a` | Initial Implementation Planner | Gemini | `GEMINI_MODELS` | `GEMINI_PLANNING_A_KEY_1/2` (alias `GEMINI_PLANNER_A_KEY_1/2`) |
| `planning_b` | Implementation Plan Optimizer | Gemini | `GEMINI_MODELS` | `GEMINI_PLANNING_B_KEY_1/2` (alias `GEMINI_PLANNER_B_KEY_1/2`) |
| `change_analyzer` | Change-request analysis | Gemini | `GEMINI_MODELS` | shared `GEMINI_API_KEYS` |
| `coding` | Code Writer, version change edits | Arena AI (Arina gateway) | `ARINA_MODEL_CODING` or `ARINA_MODEL` | `ARINA_API_KEY` |
| `debugging` | Code Reviewer and Debugger | Arena AI (Arina gateway) | `ARINA_MODEL_DEBUGGING` or `ARINA_MODEL` | `ARINA_API_KEY` |
| `testing` | Test design | Groq | `GROQ_MODEL_PLANNER` | `GROQ_TESTING_API_KEY` |
| `final_synthesis` | Plain-language explanation of measured results | Groq | `GROQ_MODEL_WRITER` | `GROQ_FINAL_SYNTHESIS_API_KEY` |

Small un-assigned decisions (intent classification, what-if planning, config-setting edits, gap experiment ideas) use the shared chain: Groq, then Gemini, then OpenRouter.

## Rules

- An agent uses **its own keys**; if it has none it uses the **shared keys of the same provider** (`GROQ_API_KEYS`, `GEMINI_API_KEYS`). It never uses another provider and never another agent's own keys.
- No credentials for an agent's provider means the call returns nothing and reports `not_configured`; nothing is faked.
- Rotation: a rate-limited key is paused for the provider's `retry-after`; a rejected key (401/403) for one hour with an operator warning; a bad request (400/404/422) stops at once because the other key would fail the same way. Short rate limits (up to 45 s) are waited out; transient errors back off (`AI_RETRY_BACKOFF_SECONDS`, doubled each time). Attempts are capped by `AI_MAX_RETRIES`, and at most `AI_MAX_CONCURRENCY_PER_KEY` requests run on one key.
- Two keys from the same account share one quota. Rotating between them adds resilience, not quota.
- Arena AI failures are reported. Another provider answers only if `ARINA_FALLBACK_TO_SHARED=true`, and the result then names the provider that really answered.
- Tests are run by the sandbox and pytest. A model only helps design tests or explain results; it cannot mark a test as passed.

## Arena AI contract (as used by the working integration)

`POST ARINA_BASE_URL` (default `https://elevate1-0.vercel.app/api/ai`), header `Authorization: Bearer <ARINA_API_KEY>`, OpenAI Chat Completions body with `"stream": false`; GPT models take `max_completion_tokens` and `reasoning_effort`, DeepSeek takes `max_tokens`; requests over 48 KB are refused locally; a shared token budget (`ARINA_TOKEN_BUDGET`, tracked in Redis) is enforced; the response text is `choices[0].message.content` with reasoning tags removed. Models: `gpt-5-mini`, `gpt-5.6-luna`, `deepseek-v4-pro`.

## Checking the connections

`GET http://localhost:8001/ai/health` shows each agent's provider, model, number of keys and where they come from (never a key).

- `?live=none` (default): configuration only.
- `?live=auth`: a free authenticated listing for every Groq and Gemini key (needs the `X-Internal-Token` header).
- `?live=request`: one tiny completion per key; Arena AI costs a few tokens of the team budget (needs the header).

Statuses: `configured`, `authentication_verified`, `request_verified`, `rate_limited`, `authentication_failed`, `provider_unavailable`, `invalid_request`, `invalid_configuration`. Live results are cached for 5 minutes. The same table is logged when the agents service starts.

## Where the variables are read

Only the agents service reads the provider variables above. The Go API reads `GROQ_API_KEYS` for voice transcription. With `docker compose`, both services load the same `.env` file (`env_file: .env`), so a variable is visible to both containers; the Go API does not use the AI-only ones. None of them is exposed to the browser (no `NEXT_PUBLIC_` variable holds a key).
