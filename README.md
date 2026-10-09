# ParadoxPop filmmaking agent

Turns an original story idea into a vertical (9:16) cinematic scene where characters talk to each other on screen. Our own orchestrator; every model (LLM, voice, video, lip-sync) sits behind a swappable provider.

## Run it

Requires Node 24+ and FFmpeg. macOS gives free real speech for test runs via `say`.

```bash
cp .env.example .env              # everything defaults to mock providers: $0
npm run make                      # renders projects/dragon-cave/final.mp4 + qc-report.json
npm run make -- --regenerate sh03 # re-render one shot, reuse everything else
npm test                          # director, validation, and a full mock render
```

Options: `--project <id>`, `--idea "<text>"`, `--target 70-80`, `--approve` (allow video spend above the approval threshold).

Outputs in `projects/<id>/`: `screenplay.json`, `audio/`, `shots/`, `final.mp4`, `final.srt`, `qc-report.json`. Metadata, jobs and spend are in `projects/paradoxpop.db`.

## Docs

- [Repository evaluation](docs/research.md): ranked picks, verified licences
- [Architecture](docs/architecture.md): data flow, modules, local vs cloud, Muse integration
- [Costs](docs/costs.md)
- [Proof of concept and acceptance criteria](docs/poc.md)

## Status

| Phase | State |
|---|---|
| 1. Research and architecture | Done (capabilities still from READMEs) |
| 2. Proof of concept | Pipeline works end to end on mock providers. Next: real GPU providers |
| 3-6 | Not started |

Next steps:
1. Phase 2 bake-off: the same 2-character, 10 s exchange through LongCat-Avatar 1.5 (free ZeroGPU Space), InfiniteTalk and LTX-2.3, scored by SyncNet plus human review.
2. Real adapters: Chatterbox voices (local), Qwen-Image-Edit keyframes, the winning dialogue model on a rented GPU.
3. QC evaluators: SyncNet, face-embedding identity check, a faster-whisper transcript check, a Muse Spark vision reviewer.
4. SFX provider (MMAudio is non-commercial, so still open), shot splitting for clips over the provider's maximum length, xfade transitions, burned-in captions.
