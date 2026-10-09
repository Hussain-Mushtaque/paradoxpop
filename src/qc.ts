import { readFile } from "node:fs/promises";
import { config } from "./config.ts";
import { ffmpegStderr, probe } from "./ff.ts";
import type { QcCheck, QcReport, RenderPlan } from "./types.ts";

const check = (name: string, ok: boolean, detail: string, shotId?: string): QcCheck => ({ name, status: ok ? "pass" : "fail", detail, shotId });
const review = (name: string, detail: string, shotId?: string): QcCheck => ({ name, status: "needs_human_review", detail, shotId });

/**
 * Only measurable things are auto-passed. Anything that needs eyes or ears (lip-sync, identity,
 * artifacts, story) stays "needs_human_review" until a real evaluator is wired in, so a report can
 * never claim a quality it didn't measure.
 */
export async function qualityCheck(opts: {
  projectId: string; finalPath: string; srtPath: string; plans: RenderPlan[]; shotPaths: string[];
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
  const cues = (await readFile(opts.srtPath, "utf8")).trim().split(/\n\s*\n/);
  checks.push(check("caption_accuracy", cues.length === lines.length && lines.every((l, i) => cues[i].endsWith(l.text)), `${cues.length} cues for ${lines.length} lines, text matches script`));

  for (const [i, plan] of opts.plans.entries()) {
    const id = plan.shot.id;
    const shot = await probe(opts.shotPaths[i]);
    checks.push(check("shot_duration", shot.durationSec >= plan.durationSec - 0.1, `${shot.durationSec.toFixed(2)}s rendered, ${plan.durationSec.toFixed(2)}s planned`, id));
    const end = plan.startSec + plan.durationSec;
    checks.push(check("dialogue_fits_shot", plan.lines.every((l) => l.startSec >= plan.startSec && l.startSec + l.durationSec <= end), "every line starts and ends inside its shot", id));
    if (plan.mode === "lipsync") checks.push(review("lip_sync", `no automatic lip-sync scorer yet (SyncNet/LSE planned); provider ${opts.providerName}`, id));
  }

  checks.push(review("character_consistency", "no automatic identity check yet (face/reference similarity planned)"));
  checks.push(review("visual_artifacts_and_continuity", "no vision reviewer yet (Muse Spark video understanding planned)"));
  checks.push(review("story_and_performance", "human review of dialogue delivery, reactions and pacing"));
  checks.push(review("sound_effects", `${opts.plans.flatMap((p) => p.shot.sfx).length} planned SFX not rendered: no SFX provider configured`));

  return { projectId: opts.projectId, createdAt: new Date().toISOString(), approved: checks.every((c) => c.status === "pass"), checks };
}
