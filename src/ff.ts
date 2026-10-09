import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function ffmpeg(args: string[]): Promise<string> {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-y", "-loglevel", "error", ...args], { maxBuffer: 64 * 1024 * 1024 });
  return stderr;
}

export async function ffmpegStderr(args: string[]): Promise<string> {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", ...args], { maxBuffer: 64 * 1024 * 1024 });
  return stderr;
}

export type ProbeStream = { codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate?: string; sample_rate?: string };

export async function probe(path: string): Promise<{ durationSec: number; streams: ProbeStream[] }> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", path]);
  const data = JSON.parse(stdout) as { format: { duration: string }; streams: ProbeStream[] };
  return { durationSec: Number(data.format.duration), streams: data.streams };
}

export const exec = run;
