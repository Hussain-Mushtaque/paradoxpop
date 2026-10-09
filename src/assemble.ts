import { rm, writeFile } from "node:fs/promises";
import { config } from "./config.ts";
import { ffmpeg, ffmpegStderr } from "./ff.ts";
import type { RenderPlan, Screenplay } from "./types.ts";

const srtTime = (sec: number) => {
  const ms = Math.round(sec * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};

export function toSrt(plans: RenderPlan[], sp: Screenplay): string {
  const names = new Map(sp.characters.map((c) => [c.id, c.name]));
  return plans.flatMap((p) => p.lines).map((l, i) =>
    `${i + 1}\n${srtTime(l.startSec)} --> ${srtTime(l.startSec + l.durationSec)}\n${l.speakerVisible ? "" : `${names.get(l.speakerId)}: `}${l.text}\n`,
  ).join("\n");
}

/**
 * One FFmpeg pass: normalise and cut the shots together, place each dialogue line at its planned
 * time, duck the ambience and music bed under speech, normalise loudness, and attach captions as a
 * subtitle track. Captions are a soft track because this FFmpeg build has no libass to burn them in.
 */
export async function assemble(plans: RenderPlan[], shotPaths: string[], sp: Screenplay, outPath: string, srtPath: string) {
  const { width, height, fps } = config.output;
  const total = plans.reduce((sum, p) => sum + p.durationSec, 0);
  const lines = plans.flatMap((p) => p.lines);
  await writeFile(srtPath, toSrt(plans, sp));

  const inputs = [
    ...shotPaths.flatMap((p) => ["-i", p]),
    ...lines.flatMap((l) => ["-i", l.audioPath]),
    "-f", "lavfi", "-i", `anoisesrc=color=brown:amplitude=0.06:sample_rate=48000:duration=${total.toFixed(3)}`,
    "-f", "lavfi", "-i", `sine=frequency=55:sample_rate=48000:duration=${total.toFixed(3)}`,
    "-i", srtPath,
  ];
  const ambienceIdx = shotPaths.length + lines.length;
  const subtitleIdx = ambienceIdx + 2;

  // ponytail: transitions are hard cuts plus fade-from-black; add xfade per shot.transitionIn when a cut needs it.
  const video = plans.map((p, i) => {
    const fade = p.shot.transitionIn === "fade" ? `,fade=t=in:st=0:d=0.6` : "";
    return `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},setsar=1,trim=duration=${p.durationSec.toFixed(3)},setpts=PTS-STARTPTS${fade}[v${i}]`;
  });
  const concat = `${plans.map((_, i) => `[v${i}]`).join("")}concat=n=${plans.length}:v=1:a=0,format=yuv420p[v]`;

  const dialogue = lines.map((l, i) => {
    const ms = Math.round(l.startSec * 1000);
    return `[${shotPaths.length + i}:a]aformat=sample_rates=48000:channel_layouts=mono,adelay=${ms}:all=1[d${i}]`;
  });
  const dialogueMix = `${lines.map((_, i) => `[d${i}]`).join("")}amix=inputs=${lines.length}:normalize=0,apad=whole_dur=${total.toFixed(3)},asplit=2[dlg][sc]`;
  const bed = [
    `[${ambienceIdx}:a]lowpass=f=900,volume=0.5[amb]`,
    `[${ambienceIdx + 1}:a]volume=0.08,afade=t=in:d=2,afade=t=out:st=${Math.max(0, total - 2).toFixed(3)}:d=2[mus]`,
    `[amb][mus]amix=inputs=2:normalize=0[bed]`,
    `[bed][sc]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=350[ducked]`,
    `[dlg][ducked]amix=inputs=2:normalize=0,aresample=48000,atrim=duration=${total.toFixed(3)}[a]`,
  ];

  const mixPath = outPath.replace(/\.mp4$/, ".mix.mp4");
  await ffmpeg([
    ...inputs,
    "-filter_complex", [...video, concat, ...dialogue, dialogueMix, ...bed].join(";"),
    "-map", "[v]", "-map", "[a]", "-map", `${subtitleIdx}:s`,
    "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-r", String(fps),
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-c:s", "mov_text", "-metadata:s:s:0", "language=eng",
    mixPath,
  ]);

  // Two-pass loudness normalisation: single-pass loudnorm undershoots on clips this short.
  const target = `I=${config.loudnessLufs}:TP=-1.5:LRA=11`;
  const stats = await ffmpegStderr(["-i", mixPath, "-af", `loudnorm=${target}:print_format=json`, "-f", "null", "-"]);
  const m = JSON.parse(stats.slice(stats.lastIndexOf("{"), stats.lastIndexOf("}") + 1)) as Record<string, string>;
  await ffmpeg([
    "-i", mixPath, "-map", "0",
    "-af", `loudnorm=${target}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`,
    "-c:v", "copy", "-c:s", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outPath,
  ]);
  await rm(mixPath);
  return { path: outPath, durationSec: total };
}
