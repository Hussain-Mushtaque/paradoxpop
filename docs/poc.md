# Proof of concept: "The Cartographer's Dragon"

Screenplay: [`stories/dragon-cave.json`](../stories/dragon-cave.json). About 25 s, 7 shots, 2 characters, 5 lines.

A colossal golden eye opens in the dark. Mira, a young explorer, steps onto a floor of coins with a torch. The dragon Vael mocks her from the darkness. She insists she isn't here for gold. He emerges and doesn't believe her. She holds up her village's map, which has his name on it. He lowers his head: "Because I drew it. For you." Her torch dies.

It deliberately tests both dialogue paths:
- **Human lip-sync on camera:** Mira's close-up (sh03) and medium shot (sh05).
- **Creature dialogue without fake lip-sync:** Vael off-screen (sh02), over Mira's shoulder (sh04), slow close-up (sh06).
- Character continuity (torch hand, map hand, Vael's single open eye), a reaction shot, and a cliffhanger ending.

## Acceptance criteria

| Area | Criterion | How it is checked | Automated today? |
|---|---|---|---|
| Format | 1080x1920, 24 fps, H.264/AAC 48 kHz, runtime 20-30 s | ffprobe | Yes |
| Audio | Integrated loudness -14 LUFS ±1.5; dialogue audible over the bed (bed ducked under speech) | ebur128; listening | Loudness yes, intelligibility by listening |
| Dialogue | Every scripted line present, in order, said by the right voice, inside its shot | Timeline check; faster-whisper transcript vs script | Timeline yes; transcript check next |
| Captions | One cue per line, text matches script, timed to the audio | SRT check | Yes |
| Lip-sync | Every `lipsync` shot: SyncNet LSE-C ≥ 6 and LSE-D ≤ 8 (starting thresholds, calibrated in Phase 2 against clips we judge good and bad), and no visible mismatch to a human reviewer. No creature mouth pretends to sync | SyncNet + human | Not yet (human review) |
| Character continuity | Same face, hair, scar, cloak and scale across shots; per-shot face-embedding similarity to the reference sheet above threshold | Face embeddings + human | Not yet |
| Visual quality | No warping hands/faces, no identity swaps, no flicker; motion reads as intentional camera work | Vision reviewer + human | Not yet |
| Assembly | Fully automatic from screenplay to `final.mp4` with no manual edit; re-running reuses finished shots | Pipeline + job table | Yes |
| Cost | Real spend recorded per shot; test scene under $10 | Spend ledger | Yes (ledger) |

A run is approved only when every check is `pass`. Anything unmeasured stays `needs_human_review`, so mock output is never auto-approved.

## Current measured result (mock providers, Mac M5)

- 25.93 s, 1080x1920, 24 fps, AAC 48 kHz, -14 LUFS, 5/5 caption cues match script, every line inside its shot.
- First run 14 s; resumed run 8 s with 0 regenerated jobs (13 jobs, 1 attempt each).
- Spend $0.00.
- Not measured: anything visual or lip-sync related, because the footage is a test pattern.
