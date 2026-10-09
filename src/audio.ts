import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { ffmpeg } from "./ff.ts";
import type { RenderPlan, ScreenPosition } from "./types.ts";

const run = promisify(execFile);
export const PCM_RATE = 16_000;

export async function pcm(path: string): Promise<Float32Array> {
  const { stdout } = await run("ffmpeg", ["-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", String(PCM_RATE), "-"], { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 });
  return new Float32Array(stdout.buffer, stdout.byteOffset, stdout.byteLength / 4);
}

export function rms(samples: Float32Array, fromSec = 0, toSec = samples.length / PCM_RATE): number {
  const from = Math.max(0, Math.floor(fromSec * PCM_RATE));
  const to = Math.min(samples.length, Math.ceil(toSec * PCM_RATE));
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return to > from ? Math.sqrt(sum / (to - from)) : 0;
}

/**
 * Median fundamental frequency of the voiced frames, by normalised autocorrelation.
 * ponytail: pitch is a proxy for "sounds male/female" (typical F0: male 85-155 Hz, female 165-255 Hz);
 * a speaker-embedding classifier is the upgrade when voices are deliberately androgynous or stylised.
 */
export function medianPitchHz(samples: Float32Array): number | undefined {
  const frame = 1024, hop = 512, minLag = Math.floor(PCM_RATE / 400), maxLag = Math.ceil(PCM_RATE / 60);
  const peak = samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
  const pitches: number[] = [];
  for (let start = 0; start + frame + maxLag < samples.length; start += hop) {
    if (rms(samples, start / PCM_RATE, (start + frame) / PCM_RATE) < peak * 0.1) continue;
    let bestLag = 0, best = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let xy = 0, xx = 0, yy = 0;
      for (let i = start; i < start + frame; i++) { const x = samples[i], y = samples[i + lag]; xy += x * y; xx += x * x; yy += y * y; }
      const r = xy / Math.sqrt(xx * yy || 1);
      if (r > best) { best = r; bestLag = lag; }
    }
    if (best > 0.6) pitches.push(PCM_RATE / bestLag);
  }
  if (!pitches.length) return undefined;
  pitches.sort((a, b) => a - b);
  return pitches[Math.floor(pitches.length / 2)];
}

/** Writes one shot-length 16 kHz mono track per visible face: that character's lines in place, silence elsewhere. */
export async function buildFaceTracks(plan: RenderPlan, dir: string): Promise<{ characterId: string; position: ScreenPosition; audioPath: string }[]> {
  return Promise.all(plan.faces.map(async (face) => {
    const lines = plan.lines.filter((l) => face.lineIds.includes(l.id));
    const audioPath = join(dir, `${plan.shot.id}.${face.characterId}.wav`);
    const delayed = lines.map((l, i) => `[${i + 1}:a]aformat=sample_rates=${PCM_RATE}:channel_layouts=mono,adelay=${Math.round((l.startSec - plan.startSec) * 1000)}:all=1[l${i}]`);
    const mix = `[0:a]${lines.map((_, i) => `[l${i}]`).join("")}amix=inputs=${lines.length + 1}:normalize=0,atrim=duration=${plan.durationSec.toFixed(3)}[a]`;
    await ffmpeg([
      "-f", "lavfi", "-i", `anullsrc=r=${PCM_RATE}:cl=mono`, ...lines.flatMap((l) => ["-i", l.audioPath]),
      "-filter_complex", [...delayed, mix].join(";"), "-map", "[a]", "-ar", String(PCM_RATE), audioPath,
    ]);
    return { characterId: face.characterId, position: face.position, audioPath };
  }));
}
