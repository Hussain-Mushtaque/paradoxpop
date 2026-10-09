export type Gender = "female" | "male" | "neutral";

export type Character = {
  id: string;
  name: string;
  /** Drives both the generated face and the voice; voice must match it. "neutral" skips the pitch check. */
  gender: Gender;
  role: string;
  appearance: string;
  wardrobe: string;
  scale: string;
  personality: string;
  voice: { voiceId: string; style: string };
  referenceImages: string[];
  relationships: Record<string, string>;
  continuity: string[];
};

export type DialogueLine = {
  id: string;
  speakerId: string;
  listenerId: string;
  text: string;
  emotion: string;
  style: string;
  speakerVisible: boolean;
  lipSync: boolean;
  listenerReaction: string;
};

export type ShotKind = "establishing" | "wide" | "medium" | "close-up" | "reaction" | "over-the-shoulder" | "tracking" | "insert";

export type Shot = {
  id: string;
  sceneId: string;
  kind: ShotKind;
  durationSec: number;
  characterIds: string[];
  environment: string;
  lighting: string;
  camera: string;
  action: string;
  lineIds: string[];
  sfx: string[];
  mood: string;
  continuity: string[];
  transitionIn: "cut" | "fade";
  /** Where each visible character's face is in frame. Required for lip-sync so audio binds to the right face. */
  blocking?: Record<string, ScreenPosition>;
};

export type ScreenPosition = "left" | "center" | "right";

/** One per visible face in a lip-sync shot: the speaker's own lines, silence for everyone else. */
export type FaceBinding = { characterId: string; position: ScreenPosition; lineIds: string[] };

export type Screenplay = {
  title: string;
  logline: string;
  hook: string;
  genre: string;
  characters: Character[];
  lines: DialogueLine[];
  shots: Shot[];
  music: string;
  ambience: string;
};

export type TimedLine = DialogueLine & { audioPath: string; startSec: number; durationSec: number };

export type RenderPlan = {
  shot: Shot;
  startSec: number;
  durationSec: number;
  lines: TimedLine[];
  mode: "lipsync" | "voiceover" | "silent";
  faces: FaceBinding[];
  prompt: string;
  notes: string[];
};

export type VideoCapabilities = {
  maxDurationSec: number;
  maxLipSyncSpeakers: number;
  /** Can drive each face with its own audio track. Without it, a lip-sync shot may contain only one face. */
  perFaceAudio: boolean;
  referenceImages: boolean;
  nativeAudio: boolean;
};

export type QcCheck = { name: string; status: "pass" | "fail" | "needs_human_review"; detail: string; shotId?: string };

export type QcReport = { projectId: string; createdAt: string; approved: boolean; checks: QcCheck[] };
