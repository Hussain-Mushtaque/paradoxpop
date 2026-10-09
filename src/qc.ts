import { readFile } from "node:fs/promises";
import { config } from "./config.ts";
import { medianPitchHz, pcm, rms } from "./audio.ts";
import { ffmpegStderr, probe } from "./ff.ts";
import type { QcCheck, QcReport, RenderPlan, Screenplay } from "./types.ts";

const check = (name: string, ok: boolean, detail: string, shotId?: string): QcCheck => ({ name, status: ok ? "pass" : "fail", detail, shotId });
const review = (name: string, detail: string, shotId?: string): QcCheck => ({ name, status: "needs_human_review", detail, shotId });

/**
 * Only measurable things are auto-passed. Anything that needs eyes or ears (lip-sync, identity,
 * artifacts, story) stays "needs_human_review" until a real evaluator is wired in, so a report can
 * never claim a quality it didn't measure.
 */
export async function qualityCheck(opts: {
  projectId: string; finalPath: string; srtPath: string; plans: RenderPlan[]; shotPaths: string[];
  faceTracks: { characterId: string; audioPath: string; position: string }[][]; screenplay: Screenplay;
  targetSec: [number, number]; providerName: string;
}): Promise<QcReport> {
  const { width, height, fps } = config.output;
  const checks: QcCheck[] = [];
  const final = await probe(opts.finalPath);
  const v = final.streams.find((s) => s.codec_type === "video");
  const a = final.streams.find((s) => s.codec_type === "audio");
  const [num, den] = (v?.r_frame_rate ?? "0/1").split("/").map(Number);

  checks.push(check("runtime", final.durationSec >= opts.targetSec[0] && final.durationSec <= opts.targetSec[1], `${final.durationSec.toFixed(2)}s, target ${opts.targetSec.join("-")}s`));
  checks.push(check("aspect_ratio", v?.width === width && v?.height === height, `${v?.width}x${v?.height}, expected ${width}x${height} (9:16)`));
  checks.push(check("frame_rate", Math.abs(num / den - fps) < 0.01, `${(num / den).toFixed(2)} fps, expected ${fps}`));
  checks.push(check("audio_stream", a?.sample_rate === "48000", a ? `${a.codec_name} ${a.sample_rate} Hz` : "no audio stream"));
  checks.push(check("caption_track", final.streams.some((s) => s.codec_type === "subtitle"), "embedded subtitle track"));

  const loudness = Number((await ffmpegStderr(["-i", opts.finalPath, "-af", "ebur128=framelog=quiet", "-f", "null", "-"])).match(/I:\s+(-?[\d.]+) LUFS/)?.[1]);
  checks.push(check("loudness", Math.abs(loudness - config.loudnessLufs) <= 1.5, `${loudness} LUFS integrated, target ${config.loudnessLufs}`));

  const lines = opts.plans.flatMap((p) => p.lines);
  const byId = new Map(opts.screenplay.characters.map((c) => [c.id, c]));
  const names = new Map(opts.screenplay.characters.map((c) => [c.id, c.name]));
  const cues = (await readFile(opts.srtPath, "utf8")).trim().split(/\n\s*\n/);
  checks.push(check("caption_accuracy", cues.length === lines.length && lines.every((l, i) => cues[i].endsWith(l.text)), `${cues.length} cues for ${lines.length} lines, text matches script`));

  for (const [i, plan] of opts.plans.entries()) {
    const id = plan.shot.id;
    const shot = await probe(opts.shotPaths[i]);
    checks.push(check("shot_duration", shot.durationSec >= plan.durationSec - 0.1, `${shot.durationSec.toFixed(2)}s rendered, ${plan.durationSec.toFixed(2)}s planned`, id));
    const end = plan.startSec + plan.durationSec;
    checks.push(check("dialogue_fits_shot", plan.lines.every((l) => l.startSec >= plan.startSec && l.startSec + l.durationSec <= end), "every line starts and ends inside its shot", id));
    if (plan.mode !== "lipsync") continue;

    // Measured: each face track carries only its own character's lines and is silent while anyone else speaks.
    const tracks = await Promise.all(opts.faceTracks[i].map(async (t) => ({ ...t, samples: await pcm(t.audioPath) })));
    const wrong = plan.lines.filter((l) => l.lipSync).flatMap((l) => tracks.flatMap((t) => {
      const level = rms(t.samples, l.startSec - plan.startSec, l.startSec - plan.startSec + l.durationSec);
      const isSpeaker = t.characterId === l.speakerId;
      return (isSpeaker ? level < 0.005 : level > 0.0005) ? [`${l.id} on ${t.characterId}'s face (${isSpeaker ? "missing" : "leaked"})`] : [];
    }));
    checks.push(check("speaker_binding", tracks.length > 0 && wrong.length === 0, wrong.length ? wrong.join("; ") : tracks.map((t) => `${t.characterId}@${t.position}`).join(", ") + ": audio only on the speaker's face", id));
    const speakers = [...new Set(plan.lines.filter((l) => l.lipSync).map((l) => names.get(l.speakerId)))].join(", ");
    checks.push(review("lip_sync", `confirm only ${speakers}'s mouth moves, in sync. Automatic scoring (SyncNet LSE, Light-ASD active speaker) not wired yet; provider ${opts.providerName}`, id));
  }

  // Measured: the voice that says each line sounds like the character's gender (pitch proxy).
  // An in-between pitch fails too: a voice that doesn't clearly sound like the character gets re-recorded.
  for (const l of lines) {
    const gender = byId.get(l.speakerId)!.gender;
    if (gender === "neutral") continue;
    const hz = medianPitchHz(await pcm(l.audioPath));
    const ok = hz !== undefined && (gender === "female" ? hz >= 165 : hz <= 155);
    checks.push(check("voice_gender", ok, `${names.get(l.speakerId)} (${gender}) median pitch ${hz ? Math.round(hz) : "?"} Hz, needs ${gender === "female" ? ">= 165" : "<= 155"}`, l.id));
  }
  // ponytail: pitch can't tell two same-gender voices apart (delivery moves it more than identity does);
  // a speaker-embedding comparison (e.g. ECAPA) per character is the upgrade for detecting voice swaps.

  checks.push(review("character_consistency", "no automatic identity check yet (face/reference similarity planned)"));
  checks.push(review("visual_artifacts_and_continuity", "no vision reviewer yet (Muse Spark video understanding planned)"));
  checks.push(review("story_and_performance", "human review of dialogue delivery, reactions and pacing"));
  checks.push(review("sound_effects", `${opts.plans.flatMap((p) => p.shot.sfx).length} planned SFX not rendered: no SFX provider configured`));

  return { projectId: opts.projectId, createdAt: new Date().toISOString(), approved: checks.every((c) => c.status === "pass"), checks };
}
