# Architecture

## Data flow

```mermaid
flowchart LR
  idea[Idea] --> story[Story director LLM]
  refs[(Movie reference library, later)] -.-> story
  story --> validate{Screenplay valid?}
  validate -- no, feedback --> story
  validate -- yes --> voice[Voice per line]
  voice --> director[Director: timing from real audio, lip-sync feasibility, prompts]
  director --> gate{Cost over threshold?}
  gate -- needs --approve --> stop[Stop]
  gate -- ok --> shots[Shot jobs per provider]
  shots --> assemble[FFmpeg assembly]
  assemble --> qc[QC: measured checks + review]
  qc -- shot failed --> shots
  qc --> human[Human approval]
  human -.-> publish[Publishing, separate, later]
```

The order matters: **voices are synthesised before any video.** Real line durations set shot lengths, and the same audio file drives the lip-sync model. Audio is never stretched to fit footage afterwards.

## Modules (all in `src/`)

| Module | Role | Status |
|---|---|---|
| `screenplay.ts` | Story/screenwriter prompt, structural validation of LLM output (characters, speakers, listeners, shot coverage, runtime) | Built, tested |
| `director.ts` | Places every line on the timeline, stretches shots to fit, chooses `lipsync` / `voiceover` / `silent` per shot from provider capabilities, writes generation prompts with character bible and continuity | Built, tested |
| `providers/llm.ts` | `mock` (returns the POC screenplay) and `meta` (Meta Model API, `muse-spark-1.3`, OpenAI-compatible) | Mock tested. Meta adapter written, **not yet called** (no key) |
| `providers/voice.ts` | `mock` uses macOS `say` (real speech, free) | Built. Chatterbox/Kokoro adapter next |
| `providers/video.ts` | Interface with capabilities (max duration, lip-sync speakers, references, native audio). `mock` renders test-pattern footage | Built. GPU adapters next |
| `db.ts` | SQLite (`node:sqlite`): documents, jobs, spend ledger. Jobs keyed by input hash, skipped when done, retried with backoff, timed out, blocked by the spending limit | Built, resume verified |
| `assemble.ts` | One FFmpeg pass: normalise and cut shots, place dialogue, ambience and music ducked under speech, then two-pass loudness to -14 LUFS; SRT plus embedded caption track | Built |
| `qc.ts` | Measured checks auto-pass/fail; lip-sync, identity, artifacts, story and SFX stay `needs_human_review` until real evaluators exist | Built |
| `pipeline.ts`, `cli.ts` | Orchestration, approval gate, one automatic re-render of failed shots, `--regenerate shXX` | Built |

Stack choice: TypeScript on Node 24 runs `.ts` files directly and ships SQLite, so the orchestrator has **zero runtime dependencies**. Python stays where the models are: each GPU model will run as a small HTTP worker (FastAPI) next to its weights, and the TypeScript adapter calls it. Large media lives on disk under `projects/<id>/`; object storage (S3/R2) only when we run more than one machine.

## Deployment recommendation

**Hybrid.** Verified on this machine: Apple M5, 24 GB RAM, 664 GB free, FFmpeg 9.0.1, Node 24, Python 3.14, uv, Docker.

| Runs on the Mac (free) | Needs an NVIDIA GPU | Paid API |
|---|---|---|
| Orchestrator, SQLite, FFmpeg assembly, QC measurements | LongCat-Avatar, InfiniteTalk, MultiTalk, Wan2.2 (S2V/T2V/I2V), LTX-2, LatentSync, MuseTalk, Qwen-Image | Meta Model API for story, screenplay and vision QC |
| Voices (Chatterbox, Kokoro), faster-whisper captions check, SyncNet scoring | ACE-Step music (the Mac works, but slowly) | |

The 14B video models need 24-80 GB of CUDA memory. They don't run usefully on Apple Silicon, so they need a cloud GPU.

**GitHub Actions is not a free GPU.** Its GPU runners are always billed ($0.052/min for the 4-core Linux GPU runner), even on public repos, and are too small for these models. Free GPU that does exist:

1. **Hugging Face ZeroGPU Spaces.** Official demos are running for LongCat-Video-Avatar 1.5 and LTX-2.3. Free quota: 5 GPU-minutes/day (2 if not logged in). PRO ($9/month): 40 min/day, then $1 per 10 min. Good enough for the Phase 2 bake-off, not for production.
2. **Kaggle / Colab free tiers.** T4-class GPUs (16 GB), too small for the 14B models without heavy offloading. Last resort.

Production: rent an A100 80 GB or H100 by the hour (RunPod, Vast, Lambda) only while a batch renders. Load the weights once per batch, not per shot.

## Muse integration

**Chosen approach: Muse runs this repo on its own VM as a skill ([`SKILL.md`](../SKILL.md)). No public API, no server, $0.**

Muse already generates clips and speech. The repo adds what it lacks: a validated screenplay, voices locked to character gender, per-shot rules for when a mouth may move, editing, loudness and QC. The loop:

1. Muse runs the CLI with `PARADOXPOP_LLM=file PARADOXPOP_VOICE=handoff PARADOXPOP_VIDEO=handoff`.
2. The pipeline writes `handoff.json` (screenplay, then voice lines, then shots) and exits with code 3.
3. Muse produces every requested file at its path and runs the command again.
4. QC failures (e.g. a male-sounding take on a female character) delete only that file, and the next run requests it again.

Muse's VM is CPU-only (2 cores, 8 GB, Ubuntu, no root), so `scripts/setup-linux.sh` installs Node 24 and a static FFmpeg in `./.tools`. Verified in an `ubuntu:24.04` container as a non-root user: the full loop finished with a 24.6 s, 1080x1920, -14 LUFS film. Muse clones the public repo; no credentials involved.

Because Muse's clips can't take a separate audio track per face, lip-sync is only allowed with **one face in frame**. Two-person shots are planned as over-the-shoulder, off-screen or reaction shots, so the wrong mouth never moves (`perFaceAudio: false` in `providers/handoff.ts`).

A hosted API/MCP connector only becomes worth it to offer ParadoxPop to other Muse users, or to add GPU lip-sync models. It isn't needed for our own production.

What Meta offers developers (for reference):

- **Meta Model API** (`https://api.meta.ai/v1`, key `MODEL_API_KEY`): `muse-spark-1.3`, OpenAI- and Anthropic-compatible, takes video and audio as input. It runs the story director, the screenwriter and, later, the vision QC reviewer. Adapter: `providers/llm.ts`.
- **Muse connectors** (`muse.ai/platform`, opened 19 Sep 2026): a hosted HTTPS MCP server or REST/OpenAPI endpoint that the Muse agent can call after Meta reviews it. Needs a public site, privacy policy, terms and support contact. This is Phase 6: expose `create_film(idea)` → returns the job and a preview link for approval. It stays separate from generation, like publishing.
