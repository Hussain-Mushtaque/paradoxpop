import assert from "node:assert/strict";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { direct } from "../src/director.ts";
import { validateScreenplay } from "../src/screenplay.ts";
import type { Screenplay } from "../src/types.ts";

const story = JSON.parse(await readFile(new URL("../stories/dragon-cave.json", import.meta.url), "utf8")) as Screenplay;
const fakeVoices = new Map(story.lines.map((l) => [l.id, { audioPath: `${l.id}.wav`, durationSec: 2 }]));

test("POC screenplay is structurally valid", () => {
  assert.deepEqual(validateScreenplay(story, [20, 30]), []);
});

test("director falls back to voice-over when the provider cannot lip-sync", () => {
  const plans = direct(structuredClone(story), fakeVoices, { maxDurationSec: 10, maxLipSyncSpeakers: 0, referenceImages: false, nativeAudio: false });
  assert.ok(plans.every((p) => p.mode !== "lipsync"));
  assert.ok(plans.flatMap((p) => p.lines).every((l) => !l.lipSync));
  assert.match(plans.find((p) => p.shot.id === "sh03")!.notes.join(), /reframed as voice-over/);
});

test("director stretches shots to fit dialogue and keeps lines inside them", () => {
  const plans = direct(structuredClone(story), fakeVoices, { maxDurationSec: 10, maxLipSyncSpeakers: 1, referenceImages: true, nativeAudio: false });
  for (const p of plans) for (const l of p.lines) assert.ok(l.startSec >= p.startSec && l.startSec + l.durationSec <= p.startSec + p.durationSec, l.id);
  assert.equal(plans.find((p) => p.shot.id === "sh03")!.mode, "lipsync");
});

test("mock pipeline renders a 9:16 scene that passes every measurable QC check", { timeout: 300_000 }, async () => {
  process.env.PARADOXPOP_PROJECTS_DIR = await mkdtemp(join(tmpdir(), "paradoxpop-"));
  const { runProject } = await import("../src/pipeline.ts");
  const { report, spentUsd } = await runProject({ projectId: "test", idea: "test", targetSec: [20, 30] });
  const failed = report.checks.filter((c) => c.status === "fail");
  assert.deepEqual(failed, []);
  assert.equal(spentUsd, 0);
  assert.equal(report.approved, false, "mock output must never be auto-approved");
});
