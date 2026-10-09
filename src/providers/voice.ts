import { exec, ffmpeg, probe } from "../ff.ts";
import type { Character, DialogueLine, Gender } from "../types.ts";
import { handoffVoice } from "./handoff.ts";

export type VoiceProvider = {
  name: string;
  /** Every voice the provider offers, with the gender it sounds like. Screenplays may only use these. */
  voices: Record<string, { gender: Gender }>;
  estimateUsd(text: string): number;
  synthesize(line: DialogueLine, speaker: Character, outPath: string): Promise<{ path: string; durationSec: number }>;
};

/**
 * Free development voice: macOS `say` gives real, intelligible speech so timing, ducking and captions
 * can be tested end to end. Not production quality; ParadoxPop voices come from a real TTS provider.
 */
export const mockVoice: VoiceProvider = {
  name: "mock-voice",
  voices: {
    Samantha: { gender: "female" }, Karen: { gender: "female" }, Kathy: { gender: "female" },
    Ralph: { gender: "male" }, Daniel: { gender: "male" }, Fred: { gender: "male" }, Albert: { gender: "male" },
  },
  estimateUsd: () => 0,
  async synthesize(line, speaker, outPath) {
    const raw = `${outPath}.aiff`;
    if (process.platform === "darwin") {
      await exec("say", ["-v", speaker.voice.voiceId, "-o", raw, line.text]);
      await ffmpeg(["-i", raw, "-ar", "48000", "-ac", "1", outPath]);
    } else {
      const seconds = Math.max(1, line.text.split(/\s+/).length / 2.6);
      await ffmpeg(["-f", "lavfi", "-i", `sine=frequency=220:duration=${seconds}`, "-ar", "48000", "-ac", "1", outPath]);
    }
    return { path: outPath, durationSec: (await probe(outPath)).durationSec };
  },
};

export const voiceFor = (name: string): VoiceProvider => (name === "handoff" ? handoffVoice : mockVoice);
