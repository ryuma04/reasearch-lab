# Paper-to-Video Explainer

A researcher picks a paper in a workspace and gets a 3–5 minute MP4 in which **Tapu**, the lab's violet mascot,
explains the problem, the method and the results in a voiceover, while the paper's own figures, tables and key
equation appear next to it.

**Where:** workspace → **Explainer video** tab (`/workspaces/{id}/video`).

## How a video is made

```
Browser ──POST /workspaces/{id}/explainer──▶ Go API ──Redis job "explainer_video"──▶ Python agent worker
                                                                                      │
  1. extracting  agents/lab/explainer/extract.py   PyMuPDF: page text, figure/table crops (from captions),
                                                   numbered display equations (crops) + exact LaTeX from the
                                                   paper's arXiv source when the symbols match the PDF
  2. scripting   agents/lab/explainer/script.py    LLM writes the scene JSON; code then fact-checks it
  3. voicing     agents/lab/explainer/voice.py     ElevenLabs /v1/text-to-speech/{voice}/with-timestamps,
                                                   one clip per scene, cached on disk
  4. rendering   agents/lab/explainer/render.py ─▶ node video/render.mjs (Remotion 4, React) ─▶ video.mp4
```

Progress (`status`, `progress`, `message`) is stored in the `explainer_videos` table and the page polls it.
Files: `DATA_DIR/workspaces/{ws}/explainer/{id}/` → `paper.json`, `script.json`, `props.json`, `public/`
(audio, figure and equation crops), `video.mp4`.

### The script and its rules (enforced in code, not only in the prompt)

| Rule | How it is enforced |
|---|---|
| Only numbers that are in the paper | Every number in narration, headings and on-screen points must appear in the PDF text; a sentence or point with an unverified number is removed. |
| Quotes are exact | Each on-screen quote must match the PDF text character for character (after whitespace/ligature normalisation); otherwise it is dropped. Its page is shown. |
| Figures and equations are real | The model can only pick extracted items by id (`F1`, `E2`); they are pixel crops of the PDF. LaTeX is shown only when it comes verbatim from the arXiv source. |
| Spoken English | No LaTeX or symbols in narration (the model says "x squared"); leftovers are stripped. |
| 3–5 minutes | 450–750 words; the model gets up to two repair rounds with the list of problems. |

Everything removed is listed in the **Fact check** card. With no AI answer at all, the script is built only from the
paper's own sentences (abstract, conclusion), so nothing is ever invented.

LLM routing: the `explainer` agent (Gemini, whole paper, low thinking so the long JSON is not cut off), then Groq with
a condensed paper. Optional dedicated key: `GEMINI_EXPLAINER_KEY_1`.

### Animation (video/src)

* `Explainer.tsx`: 1920×1080 at 30 fps, the app's "Soft Clay" palette and fonts (Fraunces, Poppins). Mascot on the
  left; on the right a sticker card with the scene kicker, heading, then the equation (KaTeX) or figure, then
  points/quotes. Each item appears when the narration reaches its cue words (ElevenLabs character timings).
* Each scene lasts exactly as long as its voice clip (+0.35 s of breathing room).
* `Mascot.tsx`: Tapu is drawn in SVG, so it is **the same violet character in every video**. Mouth opens with the
  clip's loudness (lip sync), it blinks, bobs and breathes, and its pose follows the scene: `excited` (intro),
  `thinking`, `explaining`, `pointing` (reaches over the card at the equation), `concluding` (waves).
  To change the character, edit the colours in `video/src/theme.ts` / `Mascot.tsx`; every new video uses it.

Preview without rendering: `cd video && npm run studio`.

## Limits and costs

* **ElevenLabs free tier:** 10,000 credits per key per month. `eleven_flash_v2_5` bills 0.5 credit per character
  (measured: a 4-minute video = 3,598 characters = 1,800 credits), so one free key makes about **5 new videos a
  month**. Keys in `ELEVENLABS_API_KEYS` are rotated automatically when one is out of credits.
* **Re-renders are free:** the script is cached per PDF and every clip is cached by its exact text and voice
  (`DATA_DIR/explainer_cache`). "Generate video" again (without "Write a new script") costs 0 credits and 0 LLM calls.
  "New script" or another voice costs credits again.
* **Gemini free tier:** about 20 requests per day per model on a free key; the script needs 1–3 requests.
* **Render time:** about 5 minutes for a 4-minute video on a laptop (Remotion uses half the CPU cores).
* Figure detection relies on "Figure N:" / "Table N:" captions; equation detection on numbered display equations.

## Setup

```bash
cd video && npm install          # once: Remotion + Chrome headless shell (downloaded on first render)
```

`.env`: `ELEVENLABS_API_KEYS`, optional `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID` (see `.env.example`).
Node.js 18+ is required on the machine that runs the agent worker. ffmpeg on the PATH improves lip sync (loudness);
without it the mouth follows the character timings.

## API

| Method | Path | |
|---|---|---|
| GET | `/explainer/voices` | premade voices, whether ElevenLabs is configured |
| GET | `/workspaces/{id}/explainer` | the workspace's videos (viewer) |
| POST | `/workspaces/{id}/explainer` | `{upload_id, voice_id?, fresh_script?}` (editor); a repeated click returns the video in progress |
| GET | `/explainer/{videoId}` | status, progress, script, fact-check report |
| GET | `/explainer/{videoId}/video` | the MP4 (Range requests; `?download=1`) |
| GET | `/explainer/{videoId}/asset?path=figures/F1.png` | figure/equation crops |
| DELETE | `/explainer/{videoId}` | editor; not while it is being made |
