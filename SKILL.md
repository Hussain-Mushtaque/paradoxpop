---
name: paradoxpop-film
description: Make a ParadoxPop vertical mini-movie where characters talk to each other on screen. Use whenever the user asks for a ParadoxPop film, scene, short or dialogue video. This repo plans the film, tells you exactly which voice lines and clips to make, then assembles and quality-checks them.
---

# ParadoxPop film skill

You (Muse) are the writer, voice actor and camera. This repo is the director and editor: it plans the film, binds each voice to the right face, assembles the final 9:16 video and runs quality control. **Never edit the final video yourself and never skip a handoff request.** The repo's QC is what keeps a man's voice off a woman's lips.

## Setup (once per VM)

```bash
git clone https://x-access-token:$PARADOXPOP_GITHUB_TOKEN@github.com/Hussain-Mushtaque/paradoxpop.git ~/paradoxpop
cd ~/paradoxpop && ./scripts/setup-linux.sh
```

`PARADOXPOP_GITHUB_TOKEN` comes from the Secure Credentials Store (read-only token for this repo). Never print it, never write it to a file. Later updates: `git -C ~/paradoxpop pull`.

## The loop

Run this from `~/paradoxpop` with a lowercase project id, e.g. `kitchen-argument`:

```bash
export PATH="$HOME/paradoxpop/.tools/bin:$PATH"
PARADOXPOP_LLM=file PARADOXPOP_VOICE=handoff PARADOXPOP_VIDEO=handoff \
  node --disable-warning=ExperimentalWarning src/cli.ts --project <id> --target 20-30
```

- **Exit code 3** means it's waiting for files. Read `projects/<id>/handoff.json`, produce **every** request in it, save each to its exact `path`, then run the same command again.
- **Exit code 0** means finished: `projects/<id>/final.mp4`, `final.srt` and `qc-report.json`.
- Anything else is an error. Report it to the user; don't work around it.

Requests arrive in this order, because each stage depends on the last:

### 1. `screenplay` / `screenplay-fix`
Write JSON to `path` following `instructions` exactly (they contain the writing rules and the allowed voice ids). `stories/dragon-cave.json` is a complete example of the shape. A `screenplay-fix` request lists `errors`; fix only those and save over the same file.

Every character needs a `gender`, and its `voice.voiceId` must match it (`female_*` for female, `male_*` for male). Give each character a different voice id. Only set `lipSync: true` on a line when a human speaker's face is clearly on screen, and give every shot a `blocking` position for each visible character.

### 2. `voice`
Generate speech for exactly `text`, as `character`, in a **`gender`** voice, with the given `emotion` and `style`. Save a mono WAV to `path` containing only that line: no music, no second speaker.

**One voice per voiceId:** the first time you voice e.g. `female_a`, note which of your voices you used and reuse that exact voice for every later line with `female_a`, in this film and in any retake.

QC measures pitch. A female line that sounds male fails, and you'll be asked to redo just that line.

### 3. `shot`
Generate a video clip from `prompt` (use `referenceImages` for the characters if they exist) and save an MP4 to `path`:
- Vertical 9:16, at least `minDurationSec` long (longer is fine; the editor trims). Any audio in the clip is thrown away.
- `mode: "lipsync"`: exactly one face in frame. Drive its mouth with the `drivingAudio` file if your video tool accepts audio.
- `mode: "voiceover"` or `"silent"`: **nobody's mouth moves on camera.** Speakers are off-screen, turned away or seen from behind, and listeners keep their mouths closed. This is deliberate: it's how two-person scenes avoid the wrong mouth moving.

Don't add text, captions or watermarks to clips. The editor adds captions.

## After it finishes

Show the user `final.mp4` and summarise `qc-report.json` honestly:
- `pass`: measured and fine.
- `fail`: say what failed. The next run re-requests only the failed line or shot.
- `needs_human_review`: tell the user exactly what to look at, especially every `lip_sync` item ("confirm only Mira's mouth moves").

Never call a film approved unless `approved` is true. Never publish anything without the user's explicit approval.

To redo one shot the user didn't like: add `--regenerate <shotId>` to the command, then produce the new request.
