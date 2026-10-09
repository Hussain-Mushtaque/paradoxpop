import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ffmpeg, probe } from "../ff.ts";
import type { Gender, Screenplay } from "../types.ts";
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

export type Casting = Record<string, { museVoice: string; gender: Gender }>;

const VOICE_WORD: Record<Gender, string> = { female: "a WOMAN's voice", male: "a MAN's voice", neutral: "a non-human voice" };

/**
 * Before any line is recorded, Muse must name the real voice it will use for each voice slot.
 * Without this, "female_a" is only a label and a male voice can slip onto a female character.
 */
export async function requireCasting(sp: Screenplay, dir: string): Promise<Casting> {
  const path = join(dir, "casting.json");
  const slots = [...new Set(sp.characters.map((c) => c.voice.voiceId))].map((voiceId) => {
    const cast = sp.characters.filter((c) => c.voice.voiceId === voiceId);
    return { voiceId, gender: cast[0].gender, characters: cast.map((c) => `${c.name} (${c.gender}, ${c.appearance})`), style: cast[0].voice.style };
  });
  const request = {
    kind: "casting", path, slots,
    instructions: `Write JSON {voiceId: {"museVoice": "<exact name of the voice you will use>", "gender": "female"|"male"|"neutral"}} for every slot. A female slot MUST be a voice that sounds like a woman, a male slot a voice that sounds like a man. Use a different museVoice for every slot, and use exactly that voice for every line of that slot.`,
  };
  if (!existsSync(path)) throw new AwaitingInput(request);
  const casting = JSON.parse(await readFile(path, "utf8")) as Casting;
  const errors = slots.flatMap(({ voiceId, gender }) => {
    const entry = casting[voiceId];
    if (!entry?.museVoice) return [`${voiceId}: no museVoice chosen`];
    return entry.gender === gender ? [] : [`${voiceId} is for a ${gender} character but you cast a ${entry.gender ?? "unspecified"} voice`];
  });
  const used = slots.map((s) => casting[s.voiceId]?.museVoice);
  if (new Set(used).size !== used.length) errors.push("two voice slots use the same museVoice");
  if (errors.length) throw new AwaitingInput({ ...request, kind: "casting-fix", errors });
  return casting;
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
      const casting = JSON.parse(await readFile(join(dirname(dirname(outPath)), "casting.json"), "utf8")) as Casting;
      const museVoice = casting[speaker.voice.voiceId].museVoice;
      throw new AwaitingInput({
        kind: "voice", path: supplied, lineId: line.id, character: speaker.name, gender: speaker.gender,
        voice: speaker.voice.voiceId, museVoice, style: `${speaker.voice.style}; ${line.style}`, emotion: line.emotion, text: line.text,
        instructions: `${speaker.name} is ${speaker.gender.toUpperCase()}. Record with your voice "${museVoice}" (${VOICE_WORD[speaker.gender]}) and no other voice. Speak exactly the text. Mono WAV, no music, no other speakers. A take that doesn't sound ${speaker.gender} is rejected.`,
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
  async generate({ plan, referenceImages, faceTracks, characters, outPath }) {
    if (existsSync(outPath)) return { path: outPath };
    const who = (id: string) => { const c = characters.find((x) => x.id === id)!; return `${c.name} (${c.gender.toUpperCase()})`; };
    const onScreen = plan.shot.characterIds.map(who).join(", ") || "nobody";
    const speakers = [...new Set(plan.lines.map((l) => l.speakerId))];
    const talking = plan.mode === "lipsync"
      ? `${who(plan.faces.find((f) => f.lineIds.length)!.characterId)} is the only face in frame and the only mouth that moves, following the driving audio (${who(speakers[0])}'s voice).`
      : speakers.length
        ? `Heard in this shot: ${speakers.map(who).join(", ")}. NOBODY's mouth moves on camera: ${plan.shot.characterIds.map(who).join(", ")} keep their mouths closed; the speaker is off-screen, turned away or seen from behind.`
        : "No dialogue: nobody's mouth moves.";
    throw new AwaitingInput({
      kind: "shot", path: outPath, shotId: plan.shot.id, mode: plan.mode, minDurationSec: Number(plan.durationSec.toFixed(2)),
      onScreen, prompt: plan.prompt, referenceImages, drivingAudio: faceTracks.filter((t) => plan.faces.find((f) => f.characterId === t.characterId)?.lineIds.length).map((t) => t.audioPath),
      instructions: `Vertical 9:16, at least ${plan.durationSec.toFixed(1)} s. On screen: ${onScreen}. ${talking} Keep each character's gender and face exactly as in their reference. Any clip audio is discarded.`,
    });
  },
};
