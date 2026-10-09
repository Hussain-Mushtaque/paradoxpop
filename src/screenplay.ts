import type { Screenplay, ShotKind } from "./types.ts";

const SHOT_KINDS: ShotKind[] = ["establishing", "wide", "medium", "close-up", "reaction", "over-the-shoulder", "tracking", "insert"];

export const STORY_SYSTEM_PROMPT = `You are the ParadoxPop story director and screenwriter.
Write ONE original vertical (9:16) cinematic scene as JSON. No narration: characters talk to each other on screen.
Rules:
- Open with a visual hook in the first 2 seconds. Build conflict or mystery, escalate, end on a payoff or cliffhanger.
- At least two characters with distinct voices, wants and mannerisms. Dialogue is a real conversation: short lines, subtext, no exposition dumps, no clichés ("we're not so different", "it can't be").
- Every line: speakerId, listenerId, exact text, emotion, style, speakerVisible, lipSync (true only when the speaking human face is clearly on screen), listenerReaction.
- Prefer reaction shots, over-the-shoulder shots and off-screen voices for non-human speakers; mouths of creatures are hard to sync.
- Every shot: id, sceneId, kind (${SHOT_KINDS.join(" | ")}), durationSec (2-8), characterIds, environment, lighting, camera, action, lineIds (in order), sfx, mood, continuity, transitionIn (cut | fade).
- Every line appears in exactly one shot. Character bible entries need concrete, repeatable visual detail (face, hair, scars, clothing, scale) and continuity constraints.
- Original characters and worlds only. Never imitate a real person or an existing film's characters or dialogue.
Return JSON with keys: title, logline, hook, genre, music, ambience, characters, lines, shots.
characters[]: id, name, role, appearance, wardrobe, scale, personality, voice {voiceId, style}, referenceImages[], relationships {}, continuity[].`;

export function storyUserPrompt(idea: string, targetSec: [number, number], references = "") {
  return `Idea: ${idea}\nTarget runtime: ${targetSec[0]}-${targetSec[1]} seconds.${references ? `\nFilmmaking references (techniques only, do not copy):\n${references}` : ""}`;
}

/** LLM output is untrusted: returns every structural problem so the caller can retry with feedback. */
export function validateScreenplay(value: unknown, targetSec: [number, number]): string[] {
  const sp = value as Screenplay;
  const errors: string[] = [];
  if (!sp || typeof sp !== "object") return ["not an object"];
  for (const key of ["title", "hook", "characters", "lines", "shots"] as const) if (!sp[key]) errors.push(`missing ${key}`);
  if (errors.length) return errors;

  const characterIds = new Set(sp.characters.map((c) => c.id));
  if (characterIds.size < 2) errors.push("needs at least two characters");
  if (characterIds.size !== sp.characters.length) errors.push("duplicate character ids");
  for (const c of sp.characters) if (!c.voice?.voiceId) errors.push(`character ${c.id} has no voice`);

  const lineIds = new Set(sp.lines.map((l) => l.id));
  for (const l of sp.lines) {
    if (!characterIds.has(l.speakerId)) errors.push(`line ${l.id}: unknown speaker ${l.speakerId}`);
    if (!characterIds.has(l.listenerId)) errors.push(`line ${l.id}: unknown listener ${l.listenerId}`);
    if (l.speakerId === l.listenerId) errors.push(`line ${l.id}: speaker talks to themselves`);
    if (!l.text?.trim()) errors.push(`line ${l.id}: empty text`);
  }
  if (new Set(sp.lines.map((l) => l.speakerId)).size < 2) errors.push("fewer than two characters speak");

  const used = sp.shots.flatMap((s) => s.lineIds);
  for (const id of lineIds) if (used.filter((u) => u === id).length !== 1) errors.push(`line ${id} must appear in exactly one shot`);
  for (const id of used) if (!lineIds.has(id)) errors.push(`shot references unknown line ${id}`);

  for (const s of sp.shots) {
    if (!SHOT_KINDS.includes(s.kind)) errors.push(`shot ${s.id}: invalid kind ${s.kind}`);
    if (!(s.durationSec > 0)) errors.push(`shot ${s.id}: invalid duration`);
    for (const c of s.characterIds) if (!characterIds.has(c)) errors.push(`shot ${s.id}: unknown character ${c}`);
  }
  const total = sp.shots.reduce((sum, s) => sum + s.durationSec, 0);
  if (total < targetSec[0] * 0.8 || total > targetSec[1] * 1.1) errors.push(`planned runtime ${total.toFixed(1)}s is far from target ${targetSec.join("-")}s`);
  return errors;
}
