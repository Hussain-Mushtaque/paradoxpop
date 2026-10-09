import type { RenderPlan, Screenplay, TimedLine, VideoCapabilities } from "./types.ts";

const LEAD_IN_SEC = 0.35;
const GAP_SEC = 0.3;
const TAIL_SEC = 0.45;

/**
 * Turns the screenplay into render plans after voices exist, so every shot is long enough for its
 * real dialogue audio and the video model can be driven by that audio (never the other way round).
 * When the provider can't lip-sync a shot, the shot becomes voice-over framing instead of
 * pretending: the speaker is turned away, off-screen, or seen from behind.
 */
export function direct(sp: Screenplay, voiced: Map<string, { audioPath: string; durationSec: number }>, caps: VideoCapabilities): RenderPlan[] {
  const byId = new Map(sp.characters.map((c) => [c.id, c]));
  let clock = 0;

  return sp.shots.map((shot) => {
    const notes: string[] = [];
    let cursor = LEAD_IN_SEC;
    const lines: TimedLine[] = shot.lineIds.map((id) => {
      const line = sp.lines.find((l) => l.id === id)!;
      const audio = voiced.get(id);
      if (!audio) throw new Error(`line ${id} has no voice audio`);
      const timed = { ...line, ...audio, startSec: clock + cursor };
      cursor += audio.durationSec + GAP_SEC;
      return timed;
    });
    const needed = lines.length ? cursor - GAP_SEC + TAIL_SEC : 0;
    const durationSec = Math.max(shot.durationSec, needed);
    if (durationSec > shot.durationSec + 0.01) notes.push(`extended ${shot.durationSec}s -> ${durationSec.toFixed(2)}s to fit dialogue`);
    // ponytail: shots longer than the provider limit are flagged, not split; split into A/B shots when a real provider needs it.
    if (durationSec > caps.maxDurationSec) notes.push(`exceeds provider max ${caps.maxDurationSec}s`);

    const lipSyncSpeakers = new Set(lines.filter((l) => l.lipSync && l.speakerVisible).map((l) => l.speakerId));
    let mode: RenderPlan["mode"] = lines.length ? "voiceover" : "silent";
    if (lipSyncSpeakers.size > 0 && lipSyncSpeakers.size <= caps.maxLipSyncSpeakers) mode = "lipsync";
    else if (lipSyncSpeakers.size > 0) {
      notes.push(`provider lip-syncs ${caps.maxLipSyncSpeakers} speaker(s), shot needs ${lipSyncSpeakers.size}: reframed as voice-over`);
      for (const l of lines) l.lipSync = false;
    }

    const cast = shot.characterIds.map((id) => byId.get(id)!).map((c) => `${c.name} (${c.appearance}; ${c.wardrobe}; ${c.scale})`).join(". ");
    const speech = lines.map((l) => {
      const who = byId.get(l.speakerId)!.name;
      if (mode === "lipsync" && l.lipSync) return `${who} speaks on camera, ${l.emotion}: "${l.text}"`;
      return `${who} is heard${l.speakerVisible ? "" : " off-screen"}, mouth not visible to camera; ${byId.get(l.listenerId)!.name} reacts: ${l.listenerReaction}`;
    }).join(" ");
    const prompt = [
      `${shot.kind} shot, ${shot.camera}.`, shot.action + ".", cast + ".",
      `${shot.environment}, ${shot.lighting}, mood: ${shot.mood}.`, speech,
      shot.continuity.length ? `Continuity: ${shot.continuity.join("; ")}.` : "",
      "Vertical 9:16, photoreal cinematic, anamorphic film look, natural motion, no text on screen.",
    ].filter(Boolean).join(" ");

    const plan: RenderPlan = { shot, startSec: clock, durationSec, lines, mode, prompt, notes };
    clock += durationSec;
    return plan;
  });
}
