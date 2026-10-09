import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assemble } from "./assemble.ts";
import { buildFaceTracks } from "./audio.ts";
import { config } from "./config.ts";
import { openStore } from "./db.ts";
import { direct } from "./director.ts";
import { log } from "./log.ts";
import { AwaitingInput } from "./providers/handoff.ts";
import { llmFor } from "./providers/llm.ts";
import { videoFor } from "./providers/video.ts";
import { voiceFor } from "./providers/voice.ts";
import { qualityCheck } from "./qc.ts";
import { STORY_SYSTEM_PROMPT, storyUserPrompt, validateScreenplay } from "./screenplay.ts";
import type { QcReport, Screenplay } from "./types.ts";

export type RunOptions = { projectId: string; idea: string; targetSec: [number, number]; approve?: boolean; regenerate?: string[] };

export type RunResult =
  | { status: "done"; finalPath: string; report: QcReport; spentUsd: number }
  | { status: "waiting"; handoffPath: string; requests: Record<string, unknown>[] };

export async function runProject(opts: RunOptions): Promise<RunResult> {
  const dir = join(config.projectsDir, opts.projectId);
  for (const sub of ["audio", "shots"]) await mkdir(join(dir, sub), { recursive: true });
  const store = openStore(join(config.projectsDir, "paradoxpop.db"));
  const budget = { limitUsd: config.budgetUsd };
  const screenplayInput = join(dir, "screenplay.input.json");
  const llm = llmFor(config.llm, screenplayInput);
  const voice = voiceFor(config.voice);
  const video = videoFor(config.video);
  const started = Date.now();

  // Missing handoff files are collected (not thrown one by one) so the agent gets the whole to-do list at once.
  const handoffPath = join(dir, "handoff.json");
  const waiting: Record<string, unknown>[] = [];
  const settle = async <T>(tasks: Promise<T>[]): Promise<T[] | undefined> => {
    const results = await Promise.allSettled(tasks);
    for (const r of results) {
      if (r.status === "fulfilled") continue;
      if (r.reason instanceof AwaitingInput) waiting.push(r.reason.request);
      else throw r.reason;
    }
    return waiting.length ? undefined : results.map((r) => (r as PromiseFulfilledResult<T>).value);
  };
  const handOff = async (): Promise<RunResult> => {
    await writeFile(handoffPath, JSON.stringify({ projectId: opts.projectId, requests: waiting }, null, 2));
    log("info", "waiting for handoff files", { project: opts.projectId, count: waiting.length, handoffPath });
    return { status: "waiting", handoffPath, requests: waiting };
  };
  await rm(handoffPath, { force: true });

  // 1. Story, characters, dialogue and shot list in one structured screenplay.
  const screenplayPath = join(dir, "screenplay.json");
  const fromFile = llm.name === "file";
  let feedback = "";
  let llmCostUsd = 0;
  const written = await settle([store.job({
    projectId: opts.projectId, stage: "screenplay", provider: llm.name, budget, retries: fromFile ? 0 : 2,
    input: [opts.idea, opts.targetSec, fromFile && existsSync(screenplayInput) ? await readFile(screenplayInput, "utf8") : ""],
    estimateUsd: fromFile || llm.name === "mock-llm" ? 0 : 0.05,
    work: async () => {
      const { text, costUsd } = await llm.complete(STORY_SYSTEM_PROMPT, storyUserPrompt(opts.idea, opts.targetSec, voice.voices) + feedback);
      llmCostUsd += costUsd;
      const parsed: unknown = JSON.parse(text);
      const errors = validateScreenplay(parsed, opts.targetSec, voice.voices);
      if (errors.length && fromFile) throw new AwaitingInput({ kind: "screenplay-fix", path: screenplayInput, errors });
      if (errors.length) {
        feedback = `\nYour previous draft was rejected: ${errors.join("; ")}. Fix these.`;
        throw new Error(`invalid screenplay: ${errors.join("; ")}`);
      }
      store.saveDoc(opts.projectId, "screenplay", parsed);
      await writeFile(screenplayPath, JSON.stringify(parsed, null, 2));
      return { path: screenplayPath, costUsd: llmCostUsd };
    },
  })]);
  if (!written) return handOff();
  const sp = store.loadDoc<Screenplay>(opts.projectId, "screenplay")!;

  // 2. Voices first: real dialogue timing drives shot length and audio-driven video.
  const voicedLines = await settle(sp.lines.map(async (line) => {
    const speaker = sp.characters.find((c) => c.id === line.speakerId)!;
    const out = await store.job({
      projectId: opts.projectId, stage: "voice", provider: voice.name, input: [line.text, speaker.voice, line.style], estimateUsd: voice.estimateUsd(line.text), budget,
      work: () => voice.synthesize(line, speaker, join(dir, "audio", `${line.id}.wav`)),
    });
    return [line.id, { audioPath: out.path, durationSec: out.durationSec }] as const;
  }));
  if (!voicedLines) return handOff();
  const voiced = new Map(voicedLines);

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
  const faceTracks = await Promise.all(plans.map((plan) => buildFaceTracks(plan, join(dir, "audio"))));
  const renderShots = () => settle(plans.map((plan, i) => {
    const refs = plan.shot.characterIds.flatMap((id) => sp.characters.find((c) => c.id === id)!.referenceImages);
    return store.job({
      projectId: opts.projectId, stage: "shot", provider: video.name, input: [plan.prompt, plan.durationSec, plan.mode, plan.faces, refs], estimateUsd: video.estimateUsd(plan), budget,
      work: () => video.generate({ plan, referenceImages: refs, faceTracks: faceTracks[i], outPath: join(dir, "shots", `${plan.shot.id}.mp4`) }),
    });
  }));
  // ponytail: shots render concurrently with no cap; add a pool when a rate-limited provider is plugged in.
  let shots = await renderShots();
  if (!shots) return handOff();

  // 5. Assemble and QC. A failed shot or voice check re-does only that shot or line, not the whole film.
  const finalPath = join(dir, "final.mp4");
  const srtPath = join(dir, "final.srt");
  const assembleAndCheck = async (shotPaths: string[]) => {
    await assemble(plans, shotPaths, sp, finalPath, srtPath);
    return qualityCheck({ projectId: opts.projectId, finalPath, srtPath, plans, shotPaths, faceTracks, screenplay: sp, targetSec: opts.targetSec, providerName: video.name });
  };
  let report = await assembleAndCheck(shots.map((s) => s.path));
  const failed = report.checks.filter((c) => c.status === "fail" && c.shotId);
  const badLines = failed.filter((c) => c.name === "voice_gender").map((c) => c.shotId!);
  const badShots = [...new Set(failed.filter((c) => c.name !== "voice_gender").map((c) => c.shotId!))];
  if (badLines.length && voice.name === "handoff-voice") {
    log("warn", "voice does not match character gender, requesting new takes", { lines: badLines });
    for (const id of badLines) for (const f of [`${id}.wav`, `${id}.input.wav`]) await rm(join(dir, "audio", f), { force: true });
  }
  if (badShots.length) {
    log("warn", "regenerating failed shots", { shots: badShots });
    for (const id of badShots) await rm(join(dir, "shots", `${id}.mp4`), { force: true });
    shots = await renderShots();
    if (!shots) return handOff();
    report = await assembleAndCheck(shots.map((s) => s.path));
  }

  store.saveDoc(opts.projectId, "qc-report", report);
  await writeFile(join(dir, "qc-report.json"), JSON.stringify(report, null, 2));
  const spentUsd = store.spent(opts.projectId);
  log("info", "run finished", { project: opts.projectId, seconds: Math.round((Date.now() - started) / 1000), spentUsd, approved: report.approved });
  return { status: "done", finalPath, report, spentUsd };
}
