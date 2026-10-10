import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { config } from "./config.ts";
import { exec, ffmpeg, probe } from "./ff.ts";
import { log } from "./log.ts";
import type { RenderPlan } from "./types.ts";

/**
 * Re-animates the largest face in a clip to its audio with LatentSync 1.5 on Kaggle's free T4 (30 GPU-h/week).
 * Needs the kaggle CLI and a token (KAGGLE_API_TOKEN or ~/.kaggle/access_token) on the machine running the pipeline.
 */
export type LipSyncJob = { shotId: string; clip: string; audio: string; durationSec: number };

const kaggle = (args: string[]) => exec("kaggle", args, { maxBuffer: 16 * 1024 * 1024 }).then((r) => r.stdout);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const hasKaggleToken = () =>
  Boolean(process.env.KAGGLE_API_TOKEN) || ["access_token", "kaggle.json"].some((f) => existsSync(join(homedir(), ".kaggle", f)));

async function kaggleUsername() {
  const name = (await kaggle(["config", "view"])).match(/username:\s*(\S+)/)?.[1];
  if (!name || name === "None") throw new Error("kaggle CLI has no username; check the Kaggle token");
  return name;
}

/** Runs all jobs in one Kaggle session (setup costs ~2 min, so batch). Returns synced 25 fps clips by shot id. */
// ponytail: one shared dataset + kernel slug, so two films repairing at the same time would clash; key slugs by project if that happens.
export async function repairLipSync(jobs: LipSyncJob[], workDir: string): Promise<Map<string, string>> {
  const username = await kaggleUsername();
  const datasetDir = join(workDir, "dataset");
  const kernelDir = join(workDir, "kernel");
  const outDir = join(workDir, "output");
  await rm(workDir, { recursive: true, force: true });
  for (const d of [datasetDir, kernelDir, outDir]) await mkdir(d, { recursive: true });

  // LatentSync expects 25 fps video and 16 kHz mono audio of the same length.
  for (const job of jobs) {
    const trim = ["-t", job.durationSec.toFixed(3)];
    await ffmpeg(["-i", job.clip, ...trim, "-an", "-r", "25", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", join(datasetDir, `${job.shotId}.mp4`)]);
    await ffmpeg(["-i", job.audio, ...trim, "-af", "apad", "-ar", "16000", "-ac", "1", join(datasetDir, `${job.shotId}.wav`)]);
  }
  await writeFile(join(datasetDir, "jobs.json"), JSON.stringify(jobs.map((j) => ({ shotId: j.shotId, video: `${j.shotId}.mp4`, audio: `${j.shotId}.wav` }))));

  const datasetId = `${username}/paradoxpop-lipsync-input`;
  await writeFile(join(datasetDir, "dataset-metadata.json"), JSON.stringify({ title: "paradoxpop-lipsync-input", id: datasetId, licenses: [{ name: "CC0-1.0" }] }));
  const exists = await kaggle(["datasets", "status", datasetId]).then(() => true, () => false);
  await kaggle(exists ? ["datasets", "version", "-p", datasetDir, "-m", jobs.map((j) => j.shotId).join(",")] : ["datasets", "create", "-p", datasetDir]);
  for (let i = 0; i < 60 && !(await kaggle(["datasets", "status", datasetId])).includes("ready"); i++) await sleep(10_000);

  const kernelId = `${username}/paradoxpop-lipsync`;
  await copyFile(new URL("../lipsync/kaggle/run.py", import.meta.url), join(kernelDir, "run.py"));
  await writeFile(join(kernelDir, "kernel-metadata.json"), JSON.stringify({
    id: kernelId, title: "paradoxpop-lipsync", code_file: "run.py", language: "python", kernel_type: "script",
    is_private: "true", enable_gpu: "true", enable_internet: "true", machine_shape: "NvidiaTeslaT4", dataset_sources: [datasetId],
  }));
  await kaggle(["kernels", "push", "-p", kernelDir]);
  log("info", "lip-sync job submitted to Kaggle", { kernel: kernelId, shots: jobs.map((j) => j.shotId) });

  let status = "";
  for (let waited = 0; waited < 3 * 3600_000; waited += 30_000) {
    await sleep(30_000);
    const now = (await kaggle(["kernels", "status", kernelId])).match(/"(.*)"/)?.[1] ?? "";
    if (now !== status) log("info", "kaggle status", { status: now, waitedSec: waited / 1000 + 30 });
    status = now;
    if (/complete|error|cancel/i.test(status)) break;
  }
  await kaggle(["kernels", "output", kernelId, "-p", outDir, "-o"]);
  if (!/complete/i.test(status)) throw new Error(`Kaggle run did not complete: ${status} (log in ${outDir})`);

  const results = JSON.parse(await readFile(join(outDir, "results.json"), "utf8")) as { shotId: string; ok: boolean; seconds: number; error?: string }[];
  const synced = new Map<string, string>();
  for (const r of results) {
    if (r.ok) synced.set(r.shotId, join(outDir, `${r.shotId}.mp4`));
    log(r.ok ? "info" : "error", r.ok ? "lip-synced" : "lip-sync failed", { shot: r.shotId, gpuSeconds: r.seconds, error: r.error });
  }
  return synced;
}

/** Pipeline step: swaps lip-sync shots for repaired copies (shots/<id>.synced.mp4), re-running only when a shot or its audio changed. */
export async function syncLipSyncShots(plans: RenderPlan[], shotPaths: string[], faceTracks: { characterId: string; audioPath: string }[][], dir: string) {
  const jobs: (LipSyncJob & { key: string })[] = [];
  const out = [...shotPaths];
  for (const [i, plan] of plans.entries()) {
    if (plan.mode !== "lipsync") continue;
    const speaker = plan.faces.find((f) => f.lineIds.length)?.characterId;
    const audio = faceTracks[i].find((t) => t.characterId === speaker)?.audioPath;
    if (!audio) continue;
    const syncedPath = join(dir, "shots", `${plan.shot.id}.synced.mp4`);
    const key = (await Promise.all([shotPaths[i], audio].map(async (p) => { const s = await stat(p); return `${s.size}:${s.mtimeMs}`; }))).join("|");
    const keyPath = `${syncedPath}.key`;
    if (existsSync(syncedPath) && existsSync(keyPath) && (await readFile(keyPath, "utf8")) === key) { out[i] = syncedPath; continue; }
    jobs.push({ shotId: plan.shot.id, clip: shotPaths[i], audio, durationSec: plan.durationSec, key });
  }
  if (!jobs.length) return out;
  try {
    const synced = await repairLipSync(jobs, join(dir, "lipsync"));
    for (const job of jobs) {
      const clip = synced.get(job.shotId);
      if (!clip) continue;
      const syncedPath = join(dir, "shots", `${job.shotId}.synced.mp4`);
      await ffmpeg(["-i", clip, "-an", "-r", String(config.output.fps), "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", syncedPath]);
      await writeFile(`${syncedPath}.key`, job.key);
      out[plans.findIndex((p) => p.shot.id === job.shotId)] = syncedPath;
    }
  } catch (error) {
    log("warn", "lip-sync repair failed, keeping the original shots", { error: String(error) });
  }
  return out;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { clip: { type: "string" }, audio: { type: "string" }, out: { type: "string" } } });
  if (!values.clip || !values.audio || !values.out) throw new Error("usage: npm run lipsync -- --clip <mp4> --audio <wav> --out <mp4>");
  const { durationSec } = await probe(values.clip);
  const synced = await repairLipSync([{ shotId: "clip", clip: values.clip, audio: values.audio, durationSec }], `${values.out}.lipsync`);
  await ffmpeg(["-i", synced.get("clip")!, "-i", values.audio, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-shortest", values.out]);
  console.log(`Done: ${values.out}`);
}
