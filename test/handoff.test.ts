import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// Plays Muse's part: write the screenplay, voice the lines, generate the clips, re-run until done.
test("handoff loop: screenplay, then voices, then shots, then a finished film", { skip: process.platform !== "darwin", timeout: 300_000 }, async () => {
  const projects = await mkdtemp(join(tmpdir(), "handoff-"));
  Object.assign(process.env, { PARADOXPOP_PROJECTS_DIR: projects, PARADOXPOP_LLM: "file", PARADOXPOP_VOICE: "handoff", PARADOXPOP_VIDEO: "handoff" });
  const { runProject } = await import("../src/pipeline.ts");
  const run = () => runProject({ projectId: "muse", idea: "dragon cave", targetSec: [20, 30] });
  const say = (voice: string, text: string, path: string) => execFileSync("say", ["-v", voice, "--file-format=WAVE", "--data-format=LEI16@22050", "-o", path, text]);

  let result = await run();
  assert.equal(result.status, "waiting");
  assert.equal(result.status === "waiting" && result.requests[0].kind, "screenplay");

  const story = JSON.parse(await readFile(new URL("../stories/dragon-cave.json", import.meta.url), "utf8"));
  story.characters[0].voice.voiceId = "female_a";
  story.characters[1].voice.voiceId = "male_a";
  await writeFile(join(projects, "muse", "screenplay.input.json"), JSON.stringify(story));

  result = await run();
  assert.ok(result.status === "waiting" && result.requests.length === 5 && result.requests.every((r) => r.kind === "voice"));
  // The classic mistake: Mira (female) is voiced by a man on line l2.
  for (const r of result.status === "waiting" ? result.requests : []) {
    const voice = r.lineId === "l2" ? "Ralph" : r.gender === "female" ? "Samantha" : "Ralph";
    say(voice, String(r.text), String(r.path));
  }

  result = await run();
  assert.ok(result.status === "waiting" && result.requests.every((r) => r.kind === "shot"));
  const shotRequests = result.status === "waiting" ? result.requests : [];
  assert.equal(shotRequests.length, 7);
  const sh03 = shotRequests.find((r) => r.shotId === "sh03")!;
  assert.equal(sh03.mode, "lipsync");
  assert.equal((sh03.drivingAudio as string[]).length, 1, "single face, single driving track");
  assert.equal(shotRequests.find((r) => r.shotId === "sh04")!.mode, "voiceover", "two faces in frame are never lip-synced through Muse");
  for (const r of shotRequests) {
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `testsrc2=size=720x1280:rate=24:duration=${Number(r.minDurationSec) + 0.5}`, "-pix_fmt", "yuv420p", String(r.path)]);
  }

  result = await run();
  assert.equal(result.status, "done");
  if (result.status !== "done") return;
  const l2 = result.report.checks.find((c) => c.name === "voice_gender" && c.shotId === "l2")!;
  assert.equal(l2.status, "fail", `male voice on Mira must fail: ${l2.detail}`);
  assert.ok(!existsSync(join(projects, "muse", "audio", "l2.input.wav")), "bad take removed so Muse is asked again");

  result = await run();
  assert.ok(result.status === "waiting" && result.requests.length === 1 && result.requests[0].lineId === "l2" && result.requests[0].gender === "female");
});
