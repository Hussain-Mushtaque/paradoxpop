import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { config } from "./config.ts";
import { exec, ffmpeg } from "./ff.ts";
import { log } from "./log.ts";
import type { RenderPlan } from "./types.ts";

/**
 * Re-animates mouths on lip-sync shots with LatentSync 1.5 on Kaggle's free GPU (30 h/week).
 * Runs where the Kaggle key lives (this Mac), not on Muse's VM. Originals are kept as <shot>.orig.mp4.
 */
type Job = { shotId: string; clip: string; audio: string; durationSec: number };

const { values } = parseArgs({
  options: {
    project: { type: "string" },
    shots: { type: "string", multiple: true, default: [] },
    clip: { type: "string" }, audio: { type: "string" }, out: { type: "string" },
  },
});

const kaggle = (args: string[]) => exec("kaggle", args, { maxBuffer: 16 * 1024 * 1024 }).then((r) => r.stdout);
const legacyKey = join(homedir(), ".kaggle", "kaggle.json");
const hasToken = process.env.KAGGLE_API_TOKEN || existsSync(join(homedir(), ".kaggle", "access_token")) || existsSync(legacyKey);
if (!hasToken) throw new Error("Kaggle token not found: save it to ~/.kaggle/access_token (https://www.kaggle.com/settings/api)");
const username = process.env.KAGGLE_USERNAME ?? (existsSync(legacyKey) ? (JSON.parse(await readFile(legacyKey, "utf8")) as { username: string }).username : undefined);
if (!username) throw new Error("set KAGGLE_USERNAME in .env (your Kaggle handle, not secret)");

let jobs: Job[];
let workDir: string;
if (values.project) {
  const dir = join(config.projectsDir, values.project);
  const plans = JSON.parse(await readFile(join(dir, "render-plan.json"), "utf8")) as RenderPlan[];
  jobs = plans
    .filter((p) => p.mode === "lipsync" && (!values.shots.length || values.shots.includes(p.shot.id)))
    .map((p) => {
      const speaker = p.faces.find((f) => f.lineIds.length)!.characterId;
      const original = join(dir, "shots", `${p.shot.id}.orig.mp4`);
      return { shotId: p.shot.id, clip: existsSync(original) ? original : join(dir, "shots", `${p.shot.id}.mp4`), audio: join(dir, "audio", `${p.shot.id}.${speaker}.wav`), durationSec: p.durationSec };
    });
  workDir = join(dir, "lipsync");
} else if (values.clip && values.audio && values.out) {
  jobs = [{ shotId: "clip", clip: values.clip, audio: values.audio, durationSec: 0 }];
  workDir = `${values.out}.lipsync`;
} else {
  throw new Error("use --project <id> [--shots sh03] or --clip <mp4> --audio <wav> --out <mp4>");
}
if (!jobs.length) throw new Error("no lip-sync shots to repair");

const datasetDir = join(workDir, "dataset");
const kernelDir = join(workDir, "kernel");
const outDir = join(workDir, "output");
await rm(workDir, { recursive: true, force: true });
for (const d of [datasetDir, kernelDir, outDir]) await mkdir(d, { recursive: true });

// LatentSync expects 25 fps video and 16 kHz mono audio of the same length.
for (const job of jobs) {
  const trim = job.durationSec ? ["-t", job.durationSec.toFixed(3)] : [];
  await ffmpeg(["-i", job.clip, ...trim, "-an", "-r", "25", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", join(datasetDir, `${job.shotId}.mp4`)]);
  await ffmpeg(["-i", job.audio, ...trim, "-ar", "16000", "-ac", "1", join(datasetDir, `${job.shotId}.wav`)]);
}
await writeFile(join(datasetDir, "jobs.json"), JSON.stringify(jobs.map((j) => ({ shotId: j.shotId, video: `${j.shotId}.mp4`, audio: `${j.shotId}.wav` }))));

const datasetId = `${username}/paradoxpop-lipsync-input`;
await writeFile(join(datasetDir, "dataset-metadata.json"), JSON.stringify({ title: "paradoxpop-lipsync-input", id: datasetId, licenses: [{ name: "CC0-1.0" }] }));
const exists = await kaggle(["datasets", "status", datasetId]).then(() => true, () => false);
await kaggle(exists ? ["datasets", "version", "-p", datasetDir, "-m", `shots ${jobs.map((j) => j.shotId).join(",")}`] : ["datasets", "create", "-p", datasetDir]);
for (let i = 0; i < 60 && !(await kaggle(["datasets", "status", datasetId])).includes("ready"); i++) await sleep(10_000);

const kernelId = `${username}/paradoxpop-lipsync`;
await copyFile(new URL("../lipsync/kaggle/run.py", import.meta.url), join(kernelDir, "run.py"));
await writeFile(join(kernelDir, "kernel-metadata.json"), JSON.stringify({
  id: kernelId, title: "paradoxpop-lipsync", code_file: "run.py", language: "python", kernel_type: "script",
  is_private: "true", enable_gpu: "true", enable_internet: "true", machine_shape: "NvidiaTeslaT4", dataset_sources: [datasetId],
}));
await kaggle(["kernels", "push", "-p", kernelDir]);
log("info", "lip-sync job submitted to Kaggle", { kernel: kernelId, shots: jobs.map((j) => j.shotId) });

// Install, model download and inference typically take several minutes; Kaggle caps a run at 12 h.
let status = "";
for (let waited = 0; waited < 3 * 3600_000; waited += 30_000) {
  await sleep(30_000);
  status = await kaggle(["kernels", "status", kernelId]);
  if (/complete|error|cancel/i.test(status)) break;
}
await kaggle(["kernels", "output", kernelId, "-p", outDir, "-o"]);
if (!/complete/i.test(status)) throw new Error(`Kaggle run did not complete: ${status.trim()} (log in ${outDir})`);

const results = JSON.parse(await readFile(join(outDir, "results.json"), "utf8")) as { shotId: string; ok: boolean; seconds: number; error?: string }[];
for (const r of results) {
  const job = jobs.find((j) => j.shotId === r.shotId)!;
  if (!r.ok) { log("error", "lip-sync failed", { shot: r.shotId, error: r.error }); continue; }
  const synced = join(outDir, `${r.shotId}.mp4`);
  if (values.project) {
    const target = join(config.projectsDir, values.project, "shots", `${r.shotId}.mp4`);
    const original = target.replace(/\.mp4$/, ".orig.mp4");
    if (!existsSync(original)) await rename(target, original);
    await ffmpeg(["-i", synced, "-an", "-r", String(config.output.fps), "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", target]);
  } else {
    await ffmpeg(["-i", synced, "-i", job.audio, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-shortest", values.out!]);
  }
  log("info", "lip-synced", { shot: r.shotId, gpuSeconds: r.seconds });
}
console.log(values.project ? `Done. Re-run the film command to re-assemble with synced shots.` : `Done: ${values.out}`);

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
