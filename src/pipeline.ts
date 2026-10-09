import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assemble } from "./assemble.ts";
import { config } from "./config.ts";
import { openStore } from "./db.ts";
import { direct } from "./director.ts";
import { log } from "./log.ts";
import { llmFor } from "./providers/llm.ts";
import { videoFor } from "./providers/video.ts";
import { voiceFor } from "./providers/voice.ts";
import { qualityCheck } from "./qc.ts";
import { STORY_SYSTEM_PROMPT, storyUserPrompt, validateScreenplay } from "./screenplay.ts";
import type { QcReport, Screenplay } from "./types.ts";

export type RunOptions = { projectId: string; idea: string; targetSec: [number, number]; approve?: boolean; regenerate?: string[] };

export async function runProject(opts: RunOptions): Promise<{ finalPath: string; report: QcReport; spentUsd: number }> {
  const dir = join(config.projectsDir, opts.projectId);
  for (const sub of ["audio", "shots"]) await mkdir(join(dir, sub), { recursive: true });
  const store = openStore(join(config.projectsDir, "paradoxpop.db"));
  const budget = { limitUsd: config.budgetUsd };
  const llm = llmFor(config.llm);
  const voice = voiceFor(config.voice);
  const video = videoFor(config.video);
  const started = Date.now();

  // 1. Story, characters, dialogue and shot list in one structured screenplay.
  const screenplayPath = join(dir, "screenplay.json");
  let feedback = "";
  let llmCostUsd = 0;
  await store.job({
    projectId: opts.projectId, stage: "screenplay", provider: llm.name, input: [opts.idea, opts.targetSec], estimateUsd: llm.name === "mock-llm" ? 0 : 0.05, budget,
    work: async () => {
      const { text, costUsd } = await llm.complete(STORY_SYSTEM_PROMPT, storyUserPrompt(opts.idea, opts.targetSec) + feedback);
      llmCostUsd += costUsd;
      const parsed: unknown = JSON.parse(text);
      const errors = validateScreenplay(parsed, opts.targetSec);
      if (errors.length) {
        feedback = `\nYour previous draft was rejected: ${errors.join("; ")}. Fix these.`;
        throw new Error(`invalid screenplay: ${errors.join("; ")}`);
      }
      store.saveDoc(opts.projectId, "screenplay", parsed);
      await writeFile(screenplayPath, JSON.stringify(parsed, null, 2));
      return { path: screenplayPath, costUsd: llmCostUsd };
    },
  });
  const sp = store.loadDoc<Screenplay>(opts.projectId, "screenplay")!;

  // 2. Voices first: real dialogue timing drives shot length and audio-driven video.
  const voiced = new Map<string, { audioPath: string; durationSec: number }>();
  for (const line of sp.lines) {
    const speaker = sp.characters.find((c) => c.id === line.speakerId)!;
    const out = await store.job({
      projectId: opts.projectId, stage: "voice", provider: voice.name, input: [line.text, speaker.voice, line.style], estimateUsd: voice.estimateUsd(line.text), budget,
      work: () => voice.synthesize(line, speaker, join(dir, "audio", `${line.id}.wav`)),
    });
    voiced.set(line.id, { audioPath: out.path, durationSec: out.durationSec });
  }

  // 3. Direct: timing, lip-sync feasibility, prompts.
  const plans = direct(sp, voiced, video.capabilities);
  store.saveDoc(opts.projectId, "render-plan", plans);
  for (const p of plans) for (const note of p.notes) log("info", "director", { shot: p.shot.id, note });

  const estimate = plans.reduce((sum, p) => sum + video.estimateUsd(p), 0);
  if (estimate > config.approvalThresholdUsd && !opts.approve) {
    throw new Error(`Video generation is estimated at $${estimate.toFixed(2)} (threshold $${config.approvalThresholdUsd}). Re-run with --approve to spend it.`);
  }

  // 4. Shots, each its own resumable job; --regenerate drops chosen shots so only they re-render.
  for (const id of opts.regenerate ?? []) await rm(join(dir, "shots", `${id}.mp4`), { force: true });
  const renderShots = () => Promise.all(plans.map((plan) => {
    const refs = plan.shot.characterIds.flatMap((id) => sp.characters.find((c) => c.id === id)!.referenceImages);
    return store.job({
      projectId: opts.projectId, stage: "shot", provider: video.name, input: [plan.prompt, plan.durationSec, plan.mode, refs], estimateUsd: video.estimateUsd(plan), budget,
      work: () => video.generate({ plan, referenceImages: refs, dialogueAudioPath: plan.lines[0]?.audioPath, outPath: join(dir, "shots", `${plan.shot.id}.mp4`) }),
    });
  }));
  // ponytail: shots render concurrently with no cap; add a pool when a rate-limited provider is plugged in.
  let shotPaths = (await renderShots()).map((s) => s.path);

  // 5. Assemble and QC. A failed shot-level check re-renders that shot once, not the whole film.
  const finalPath = join(dir, "final.mp4");
  const srtPath = join(dir, "final.srt");
  const assembleAndCheck = async () => {
    await assemble(plans, shotPaths, sp, finalPath, srtPath);
    return qualityCheck({ projectId: opts.projectId, finalPath, srtPath, plans, shotPaths, targetSec: opts.targetSec, providerName: video.name });
  };
  let report = await assembleAndCheck();
  const failedShots = [...new Set(report.checks.filter((c) => c.status === "fail" && c.shotId).map((c) => c.shotId!))];
  if (failedShots.length) {
    log("warn", "regenerating failed shots", { shots: failedShots });
    for (const id of failedShots) await rm(join(dir, "shots", `${id}.mp4`), { force: true });
    shotPaths = (await renderShots()).map((s) => s.path);
    report = await assembleAndCheck();
  }

  store.saveDoc(opts.projectId, "qc-report", report);
  await writeFile(join(dir, "qc-report.json"), JSON.stringify(report, null, 2));
  const spentUsd = store.spent(opts.projectId);
  log("info", "run finished", { project: opts.projectId, seconds: Math.round((Date.now() - started) / 1000), spentUsd, approved: report.approved });
  return { finalPath, report, spentUsd };
}
