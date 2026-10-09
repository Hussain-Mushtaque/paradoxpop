import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { ffmpeg, probe } from "../ff.ts";
import type { LlmProvider } from "./llm.ts";
import type { VideoProvider } from "./video.ts";
import type { VoiceProvider } from "./voice.ts";

/**
 * Handoff providers let an outside agent (Muse) be the writer, voice actor and video generator.
 * When a file is missing they throw AwaitingInput describing exactly what to produce; the
 * pipeline collects every request into handoff.json and stops. Re-running picks up the files.
 */
export class AwaitingInput extends Error {
  readonly request: Record<string, unknown>;
  constructor(request: Record<string, unknown>) {
    super(`awaiting ${String(request.kind)} at ${String(request.path)}`);
    this.request = request;
  }
}

export function fileLlm(path: string): LlmProvider {
  return {
    name: "file",
    async complete(system, user) {
      if (!existsSync(path)) throw new AwaitingInput({ kind: "screenplay", path, instructions: `${system}\n\n${user}`, example: "stories/dragon-cave.json" });
      return { text: await readFile(path, "utf8"), costUsd: 0 };
    },
  };
}

export const handoffVoice: VoiceProvider = {
  name: "handoff-voice",
  voices: {
    female_a: { gender: "female" }, female_b: { gender: "female" }, female_c: { gender: "female" },
    male_a: { gender: "male" }, male_b: { gender: "male" }, male_c: { gender: "male" },
    neutral_a: { gender: "neutral" },
  },
  estimateUsd: () => 0,
  async synthesize(line, speaker, outPath) {
    const supplied = outPath.replace(/\.wav$/, ".input.wav");
    if (!existsSync(supplied)) {
      throw new AwaitingInput({
        kind: "voice", path: supplied, lineId: line.id, character: speaker.name, gender: speaker.gender,
        voice: speaker.voice.voiceId, style: `${speaker.voice.style}; ${line.style}`, emotion: line.emotion, text: line.text,
        instructions: `Speak exactly this text as ${speaker.name} using the same ${speaker.gender} voice every time ${speaker.voice.voiceId} appears. Mono WAV, no music, no other speakers.`,
      });
    }
    await ffmpeg(["-i", supplied, "-af", "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse", "-ar", "48000", "-ac", "1", outPath]);
    return { path: outPath, durationSec: (await probe(outPath)).durationSec };
  },
};

export const handoffVideo: VideoProvider = {
  name: "handoff-video",
  // Muse's generated clips can't take one audio track per face, so lip-sync is only allowed with one face in frame.
  capabilities: { maxDurationSec: 10, maxLipSyncSpeakers: 1, perFaceAudio: false, referenceImages: true, nativeAudio: false },
  estimateUsd: () => 0,
  async generate({ plan, referenceImages, faceTracks, outPath }) {
    if (existsSync(outPath)) return { path: outPath };
    throw new AwaitingInput({
      kind: "shot", path: outPath, shotId: plan.shot.id, mode: plan.mode, minDurationSec: Number(plan.durationSec.toFixed(2)),
      prompt: plan.prompt, referenceImages, drivingAudio: faceTracks.map((t) => t.audioPath),
      instructions: plan.mode === "lipsync"
        ? `Vertical 9:16, at least ${plan.durationSec.toFixed(1)} s. Exactly one face in frame; its mouth follows the driving audio. Any clip audio is discarded.`
        : `Vertical 9:16, at least ${plan.durationSec.toFixed(1)} s. No visible mouth movement on anyone: speakers are off-screen, turned away or seen from behind. Any clip audio is discarded.`,
    });
  },
};
