# Cost estimate

Prices verified 9 Oct 2026 unless marked. **GPU time per clip is an assumption, not a measurement**; Phase 2 measures it and this file gets corrected.

## Per component

| Component | Type | Price |
|---|---|---|
| Orchestrator, SQLite, FFmpeg, QC measurements | Free, local | $0 |
| Voices: Chatterbox / Kokoro | Free, local | $0 |
| Captions check (faster-whisper), SyncNet | Free, local | $0 |
| Story + screenplay: `muse-spark-1.3` | Paid per token | $1.25 / M input, $4.25 / M output |
| Same, `muse-spark-1.3-contributor` | Paid per token, Meta may train on prompts | $0.10 / $0.20 per M. **Not for unreleased stories** |
| Vision QC: `muse-spark-1.3` with video input | Paid per token | Video token count per second not yet checked |
| Dialogue/video/image/music models | Free weights, paid GPU | See below |
| HF ZeroGPU | Free allowance | 5 min/day free; PRO $9/mo for 40 min/day, then $6/GPU-hour |
| Rented A100 80 GB / H100 | Paid per hour | ~$1.2-3/hour (**not re-verified today**; check provider) |
| Storage | Local disk | ~0.5-2 GB per film including takes; $0 locally |
| GitHub Actions GPU runner | Paid per minute | $0.052/min; not used |

## Scenarios

Assumptions: talking-head or 14B I2V model at 480-720p takes **3-10 GPU-minutes per 5 s of footage**; each shot needs **3 takes** on average (best-of-k plus failures); plus 15 min per batch for loading ~75 GB of weights; GPU at $2/hour.

| Scenario | Footage | Generated (x3) | GPU minutes | GPU cost | LLM | Total |
|---|---|---|---|---|---|---|
| 20-30 s test scene | 25 s | 75 s | 45-150 + 15 | $2-6 | <$0.25 | **~$2-6** |
| 70-80 s mini-movie | 75 s | 225 s | 135-450 + 15 | $5-16 | <$0.50 | **~$5-17** |
| 3 mini-movies/day | 225 s | 675 s | 405-1350 + 15 | $14-45/day | <$1.50/day | **~$15-47/day, ~$450-1,400/month** |

On HF ZeroGPU credits ($6/hour) the same work costs about 3x the rented-GPU price. The free 5 minutes a day covers about one test take, so "free" is only realistic for the Phase 2 comparison, not for production.

Controls already built: a hard total budget (`PARADOXPOP_BUDGET_USD`), an approval threshold that stops before video spend (`--approve`), a spend ledger per project/provider/stage, and resumable jobs so a failure never re-bills finished shots. Known gap: if every retry of an LLM call fails, the tokens spent on those failed attempts aren't recorded in the ledger.
