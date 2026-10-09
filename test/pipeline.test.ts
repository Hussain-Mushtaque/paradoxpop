import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { medianPitchHz, pcm } from "../src/audio.ts";
import { direct } from "../src/director.ts";
import { mockVoice } from "../src/providers/voice.ts";
import { genderContradiction, validateScreenplay } from "../src/screenplay.ts";
import type { Screenplay, VideoCapabilities } from "../src/types.ts";

const story = JSON.parse(await readFile(new URL("../stories/dragon-cave.json", import.meta.url), "utf8")) as Screenplay;
const fakeVoices = new Map(story.lines.map((l) => [l.id, { audioPath: `${l.id}.wav`, durationSec: 2 }]));
const caps = (over: Partial<VideoCapabilities> = {}): VideoCapabilities => ({ maxDurationSec: 10, maxLipSyncSpeakers: 2, perFaceAudio: true, referenceImages: true, nativeAudio: false, ...over });

/** sh04 as a two-shot where Vael speaks on camera: the case where the wrong mouth could move. */
const twoShot = () => {
  const sp = structuredClone(story);
  sp.lines.find((l) => l.id === "l3")!.lipSync = true;
  return sp;
};

test("POC screenplay is structurally valid", () => {
  assert.deepEqual(validateScreenplay(story, [20, 30], mockVoice.voices), []);
});

test("validation rejects a male voice on a female character and shared voices", () => {
  const sp = structuredClone(story);
  sp.characters[0].voice.voiceId = "Ralph";
  const errors = validateScreenplay(sp, [20, 30], mockVoice.voices);
  assert.ok(errors.some((e) => /mira is female but voice Ralph is male/.test(e)), errors.join());
  assert.ok(errors.includes("two characters share a voice"));
});

test("validation rejects a gender label that contradicts the description, and neutral on-camera speakers", () => {
  const sp = structuredClone(story);
  sp.characters[0].gender = "male";
  sp.characters[0].voice.voiceId = "Daniel";
  assert.ok(validateScreenplay(sp, [20, 30], mockVoice.voices).some((e) => /mira is male but is described as "woman"/.test(e)));
  sp.characters[0].gender = "neutral";
  assert.ok(validateScreenplay(sp, [20, 30], mockVoice.voices).some((e) => /mira speaks on camera.*not neutral/.test(e)));
  assert.equal(genderContradiction("female", "woman, 19, his late father's compass"), undefined, "own-gender word present: no false alarm");
});

test("two-shot binds the line to the speaker's face only; the listener gets silence", () => {
  const sh04 = direct(twoShot(), fakeVoices, caps()).find((p) => p.shot.id === "sh04")!;
  assert.equal(sh04.mode, "lipsync");
  assert.deepEqual(sh04.faces, [{ characterId: "mira", position: "left", lineIds: [] }, { characterId: "vael", position: "right", lineIds: ["l3"] }]);
  assert.match(sh04.prompt, /Mira listens with mouth closed/);
});

test("without per-face audio, a two-shot is never lip-synced", () => {
  const sh04 = direct(twoShot(), fakeVoices, caps({ perFaceAudio: false })).find((p) => p.shot.id === "sh04")!;
  assert.equal(sh04.mode, "voiceover");
  assert.match(sh04.notes.join(), /wrong mouth could move/);
  assert.equal(direct(twoShot(), fakeVoices, caps({ perFaceAudio: false })).find((p) => p.shot.id === "sh03")!.mode, "lipsync", "single-face shots still lip-sync");
});

test("missing screen positions fall back to voice-over", () => {
  const sp = twoShot();
  delete sp.shots.find((s) => s.id === "sh04")!.blocking;
  assert.equal(direct(sp, fakeVoices, caps()).find((p) => p.shot.id === "sh04")!.mode, "voiceover");
});

test("pitch tells the female voice from the male voice", { skip: process.platform !== "darwin" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "pitch-"));
  const hz = async (voice: string) => {
    execFileSync("say", ["-v", voice, "-o", join(dir, `${voice}.aiff`), "I'm not here for your gold."]);
    return medianPitchHz(await pcm(join(dir, `${voice}.aiff`)))!;
  };
  assert.ok((await hz("Samantha")) >= 165, "Samantha should read female");
  assert.ok((await hz("Ralph")) <= 155, "Ralph should read male");
});

test("mock pipeline renders a 9:16 scene that passes every measurable QC check", { timeout: 300_000 }, async () => {
  process.env.PARADOXPOP_PROJECTS_DIR = await mkdtemp(join(tmpdir(), "paradoxpop-"));
  const { runProject } = await import("../src/pipeline.ts");
  const result = await runProject({ projectId: "test", idea: "test", targetSec: [20, 30] });
  assert.equal(result.status, "done");
  if (result.status !== "done") return;
  assert.deepEqual(result.report.checks.filter((c) => c.status === "fail"), []);
  assert.ok(result.report.checks.some((c) => c.name === "speaker_binding" && c.status === "pass"));
  if (process.platform === "darwin") assert.equal(result.report.checks.filter((c) => c.name === "voice_gender" && c.status === "pass").length, 5);
  assert.equal(result.spentUsd, 0);
  assert.equal(result.report.approved, false, "mock output must never be auto-approved");
});
