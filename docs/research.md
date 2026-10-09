# Repository evaluation

Checked 9 Oct 2026. "Verified" means read from the GitHub API (repo licence, last push) and the Hugging Face API (weight licence) on that date. Capabilities are still from READMEs and model cards: **nothing below has been run on a GPU yet.** Phase 2 replaces claims with measurements.

Licences of code and weights often differ. The weight licence is what decides commercial use.

## Ranked shortlist

| # | Component | Pick | Why |
|---|---|---|---|
| 1 | Two-character dialogue video | **LongCat-Video-Avatar 1.5** (meituan-longcat/LongCat-Video) | MIT weights, dual-audio mode for turn-taking speech, official free ZeroGPU demo exists |
| 2 | Dialogue video, alternative | **InfiniteTalk** (MeiGen-AI) | Apache-2.0 code and weights, multi-person, re-dubs existing video (lip, head, body) or animates image + audio |
| 3 | Audio-driven cinematic shots | **Wan2.2-S2V-14B** (Wan-Video/Wan2.2) | Apache-2.0, verified in repo (Aug 2025), built-in CosyVoice TTS path |
| 4 | Non-dialogue shots (establishing, creature, action) | **Wan2.2 T2V/I2V**, with **LTX-2.3** as a native-audio alternative | Wan2.2 Apache-2.0. LTX-2 has a custom community licence (free under a revenue cap, read before use) |
| 5 | Lip repair pass | **LatentSync 1.6**, then **MuseTalk** | LatentSync weights are OpenRAIL++ (commercial use allowed, with use restrictions), MuseTalk weights MIT |
| 6 | Character sheets and per-shot keyframes | **Qwen-Image / Qwen-Image-Edit-2509** | Apache-2.0. Keyframe-from-reference is how identity carries between shots |
| 7 | Voices | **Chatterbox** (MIT, weights MIT), **Kokoro-82M** (Apache-2.0), **CosyVoice 2** (Apache-2.0) | All run locally. Chatterbox for expressive character voices, Kokoro for fast drafts |
| 8 | Music | **ACE-Step v1 3.5B** | Apache-2.0 weights |
| 9 | Speech recognition (caption check, movie library) | **faster-whisper** | MIT, runs on the Mac |
| 10 | Lip-sync scoring for QC | **SyncNet** (joonson/syncnet_python) | MIT, the standard LSE-C/LSE-D metric |
| 11 | Orchestration reference | **ViMax** (HKUDS), **VideoClaw** (HITsz-TMG) | Both MIT and active. Borrow agent prompts and best-of-k QC ideas; do not depend on them |
| 12 | Editing | **FFmpeg** | Already installed (9.0.1). Used directly, no wrapper |

## Verified licence and activity table

| Repo | Code licence | Weight licence | Last push | Type | Local? | External API? | Multi-character dialogue | Reference-based identity | Audio-driven / lip-sync | Commercial use |
|---|---|---|---|---|---|---|---|---|---|---|
| HKUDS/ViMax | MIT | n/a | 2026-09-30 | Agent framework | Orchestration only | Yes (Veo, Seedance) | No lip-sync stage | Yes (claimed) | No | Yes |
| HITsz-TMG/VideoClaw (was FilmAgent) | MIT | n/a | 2026-08-26 | Agent app | Orchestration only | Yes | Not verified | Not verified | Not verified | Yes |
| calesthio/OpenMontage | AGPL-3.0 | n/a | 2026-10-03 | Agent workflow | Yes | Optional | No | No | TTS narration only | Only if we publish our service's source |
| meituan-longcat/LongCat-Video (Avatar 1.5) | MIT | MIT | 2026-05-27 | Model | CUDA GPU | No | Yes, dual audio (claimed) | Yes, reference image | Yes | Yes (trademarks excluded) |
| MeiGen-AI/InfiniteTalk | Apache-2.0 | Apache-2.0 | 2026-05-22 | Model | CUDA GPU | No | Yes (multi-person weights) | Image or video input | Yes | Yes |
| MeiGen-AI/MultiTalk | Apache-2.0 | Apache-2.0 | 2026-05-22 | Model | CUDA GPU | No | Yes, ~15 s max | Image input | Yes | Yes |
| Wan-Video/Wan2.2 (incl. S2V, Animate) | Apache-2.0 | Apache-2.0 | 2026-09-21 | Model | CUDA GPU | No | Not verified for S2V | Image input | S2V: yes | Yes |
| Lightricks/LTX-2 / LTX-2.3 | custom | LTX-2 community licence | 2026-10-02 | Model | CUDA GPU | No | Native speech (claimed) | Image input | Native audio | Under revenue cap; read licence |
| bytedance/LatentSync | Apache-2.0 | OpenRAIL++ | 2025-06-20 | Lip-sync model | CUDA GPU, 8-18 GB | No | One face per pass | n/a | Repair existing video | Yes, with use restrictions |
| TMElyralab/MuseTalk | custom (NOASSERTION) | MIT | 2025-09-26 | Lip-sync model | CUDA GPU | No | One face per pass | n/a | Repair | Weights yes; check code licence file |
| character-ai/Ovi | Apache-2.0 | not checked | 2025-11-15 | Model | 32 GB GPU | No | Native audio | No | 5 s clips | Low priority, inactive |
| Rudrabha/Wav2Lip | none | n/a | 2025-06-22 | Lip-sync | Yes | No | No | n/a | Yes | **No** (non-commercial) |
| showlab/MovieAgent | none | n/a | 2025-03-26 | Research agent | No | GPT-4o | Unclear | Unclear | Unclear | **No licence = no rights** |
| Comfy-Org/ComfyUI | GPL-3.0 | n/a | 2026-10-09 | Node workflow app | Yes | Optional | Via nodes | Via nodes | Via nodes | Yes as a separate service; GPL if we ship it inside our product |
| remotion-dev/remotion | custom | n/a | 2026-10-09 | Programmatic video | Yes | No | n/a | n/a | n/a | Paid company licence above small teams. **Not used**; FFmpeg instead |
| resemble-ai/chatterbox | MIT | MIT | 2026-07-21 | TTS | Mac (CPU/MPS) | No | n/a | Voice prompt | n/a | Yes |
| hexgrad/Kokoro-82M | Apache-2.0 | Apache-2.0 | 2025-08-06 | TTS | Mac | No | n/a | Preset voices | n/a | Yes |
| SWivid/F5-TTS | MIT | **CC-BY-NC-4.0** | 2026-09-21 | TTS | Mac | No | n/a | Voice cloning | n/a | **No** (weights) |
| hkchengrex/MMAudio | MIT | **CC-BY-NC-4.0** | 2026-02-23 | Video-to-SFX | GPU | No | n/a | n/a | n/a | **No** (weights) |
| Tencent-Hunyuan/HunyuanVideo-Foley | custom | not checked | 2025-09-28 | Video-to-SFX | GPU | No | n/a | n/a | n/a | Read licence before use |
| ace-step/ACE-Step | Apache-2.0 | Apache-2.0 | 2026-02-15 | Music | GPU / Mac (slow) | No | n/a | n/a | n/a | Yes |
| Qwen-Image / Qwen-Image-Edit-2509 | n/a | Apache-2.0 | 2025-09 | Image + edit | GPU | No | n/a | Yes (edit from reference) | n/a | Yes |
| FLUX.1 Kontext dev / FLUX.2 dev | n/a | **non-commercial** | 2026 | Image edit | GPU | No | n/a | Yes | n/a | **No** without a paid BFL licence |
| SYSTRAN/faster-whisper | MIT | MIT (Whisper) | 2026-10-06 | ASR | Mac | No | n/a | n/a | n/a | Yes |
| joonson/syncnet_python | MIT | not checked | 2026-04-17 | Lip-sync metric | CPU/GPU | No | n/a | n/a | Scoring | Yes |

Corrections to the earlier survey: Wan2.2-S2V is confirmed. FilmAgent is now VideoClaw (active, MIT), not a 3D-only research agent. Ovi is Apache-2.0. LatentSync weights are OpenRAIL++, not Apache. Sound effects remain open: MMAudio is non-commercial, so the SFX provider still needs choosing.

## Recommendation

Own a small TypeScript orchestrator (this repo) and put every model behind a provider adapter. ViMax and VideoClaw are reference code, not dependencies: neither has a dialogue stage, both assume paid video APIs, and forking a Python agent framework would tie us to its structure. The orchestration logic we need (screenplay validation, voice-first timing, lip-sync fallback, resumable jobs, QC) is a few hundred lines and is already built.

Dialogue strategy, in order of preference:
1. Single-speaker close-up or over-the-shoulder shot: keyframe from the character's reference sheet (Qwen-Image-Edit) plus the line's audio into LongCat-Avatar or InfiniteTalk.
2. Two faces talking in one frame: LongCat-Avatar dual-audio mode, falling back to MultiTalk.
3. Creature speakers, or any shot the provider can't sync: the director reframes it as voice-over (speaker off-screen, from behind, or reaction shot). This is implemented and tested.
4. Lip-sync repair: LatentSync on any human close-up whose SyncNet score is below threshold.
