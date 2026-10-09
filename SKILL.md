---
name: paradoxpop-film
description: Make a ParadoxPop vertical mini-movie where characters talk to each other on screen. Use whenever the user asks for a ParadoxPop film, scene, short or dialogue video. You research and decide what to make; this repo then plans the shots, tells you exactly which voice lines and clips to make, and assembles and quality-checks them.
---

# ParadoxPop film skill

You (Muse) are the writer, voice actor and camera. This repo is the director and editor: it plans the film, binds each voice to the right face, assembles the final 9:16 video and runs quality control. **Never edit the final video yourself and never skip a handoff request.** The repo's QC is what keeps a man's voice off a woman's lips.

## Setup (once per VM)

```bash
git clone https://github.com/Hussain-Mushtaque/paradoxpop.git ~/paradoxpop
cd ~/paradoxpop && ./scripts/setup-linux.sh
```

The repo is public; no token is needed. Before every film run `git -C ~/paradoxpop pull` to get the latest rules.

**ParadoxPop films are only made through this repo.** If the clone, setup or a run fails, stop and tell the user what failed. Never fall back to making the film on your own: that skips the voice and lip checks.

## Step 0: decide what to make (your call)

You choose the video. Research what is working right now for short vertical films on the target platform (YouTube Shorts, Reels): themes, hooks, pacing, length. Check what ParadoxPop has already made (`projects/*/screenplay.json`) so you don't repeat a premise. Then decide:
- **Concept**: one or two sentences, original. No real people, no existing film characters or plots.
- **Genre and tone**: anything, e.g. comedy, horror, sci-fi mystery, fantasy, drama.
- **Length**: `--target` in seconds, e.g. `20-30` for a test scene, `70-80` for a full mini-movie.

The repo's one fixed rule is that at least two characters talk to each other on screen. Everything else is up to you.

Put your reasoning in the screenplay as a top-level `brief` object: `{ "platform", "audience", "format", "why", "sources" }`. It's kept with the project so results can later be compared with what was predicted.

## The loop

Run this from `~/paradoxpop` with a lowercase project id, e.g. `kitchen-argument`:

```bash
export PATH="$HOME/paradoxpop/.tools/bin:$PATH"
PARADOXPOP_LLM=file PARADOXPOP_VOICE=handoff PARADOXPOP_VIDEO=handoff \
  node --disable-warning=ExperimentalWarning src/cli.ts --project <id> --idea "<your concept>" --target <min-max>
```

Use the same `--idea` and `--target` on every re-run of a project.

- **Exit code 3** means it's waiting for files. Read `projects/<id>/handoff.json`, produce **every** request in it, save each to its exact `path`, then run the same command again.
- **Exit code 0** means finished: `projects/<id>/final.mp4`, `final.srt` and `qc-report.json`.
- Anything else is an error. Report it to the user; don't work around it.

Requests arrive in this order, because each stage depends on the last:

### 1. `screenplay` / `screenplay-fix`
Write JSON to `path` following `instructions` exactly (they contain the writing rules and the allowed voice ids). `stories/dragon-cave.json` is a complete example of the shape. A `screenplay-fix` request lists `errors`; fix only those and save over the same file.

Every character needs a `gender` (`female` or `male` for anyone who speaks on camera), and its `voice.voiceId` must match it (`female_*` for female, `male_*` for male). The `appearance` must agree: a woman is described as a woman. A mismatch is rejected. Give each character a different voice id. Only set `lipSync: true` on a line when a human speaker's face is clearly on screen, and give every shot a `blocking` position for each visible character.

### 2. `casting` / `casting-fix`: pick real voices BEFORE recording anything
This is the step that stops a woman speaking with a man's voice. For every slot in `slots`, choose one of **your actual voices** and write `casting.json` at `path`:

```json
{ "female_a": { "museVoice": "<exact name of a woman's voice you have>", "gender": "female" },
  "male_a":   { "museVoice": "<exact name of a man's voice you have>",   "gender": "male" } }
```

Rules:
- A `female_*` slot gets a voice that **sounds like a woman**. A `male_*` slot gets a voice that **sounds like a man**. Before choosing, listen to or check the voice; don't guess from its name.
- Every slot gets a **different** `museVoice`.
- After casting, a slot's voice never changes: not between lines, not in retakes, not in later re-runs.

### 3. `voice`
Each request names the character, their **gender** and the exact `museVoice` to use. Record exactly `text` with **that voice and no other**, with the given `emotion` and `style`. Save a mono WAV to `path` containing only that line: no music, no second speaker.

Before saving, check: *is this character a woman? Then does this take sound like a woman?* (And the same for men.) If not, re-record.

QC measures the pitch of every line. A female line under 165 Hz or a male line over 155 Hz fails and is requested again. Natural variation between lines is fine; don't chase it with speed or pitch tricks.

### 4. `shot`
Each request says who is on screen (with gender) and whose voice is heard. Follow it literally; never let a woman's mouth move while a man's line plays, or the other way round.
Generate a video clip from `prompt` (use `referenceImages` for the characters if they exist) and save an MP4 to `path`:
- Vertical 9:16, at least `minDurationSec` long (longer is fine; the editor trims). Any audio in the clip is thrown away.
- `mode: "lipsync"`: exactly one face in frame. Drive its mouth with the `drivingAudio` file if your video tool accepts audio.
- `mode: "voiceover"` or `"silent"`: **nobody's mouth moves on camera.** Speakers are off-screen, turned away or seen from behind, and listeners keep their mouths closed. This is deliberate: it's how two-person scenes avoid the wrong mouth moving.

Don't add text, captions or watermarks to clips. The editor adds captions.

## After it finishes

The only film you may show the user is `projects/<id>/final.mp4`, built by this repo. Never assemble, re-cut or re-voice it yourself, and never use the audio from your generated clips: that skips every voice check.

Show the user `final.mp4` and summarise `qc-report.json` honestly:
- `pass`: measured and fine.
- `fail`: say what failed. The next run re-requests only the failed line or shot.
- `needs_human_review`: tell the user exactly what to look at, especially every `lip_sync` item ("confirm only Mira's mouth moves").

Never call a film approved unless `approved` is true. Never publish anything without the user's explicit approval.

To redo one shot the user didn't like: add `--regenerate <shotId>` to the command, then produce the new request.
