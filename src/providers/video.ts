import { config } from "../config.ts";
import { ffmpeg } from "../ff.ts";
import { handoffVideo } from "./handoff.ts";
import type { RenderPlan, ScreenPosition, VideoCapabilities } from "../types.ts";

/**
 * faceTracks is set for lip-sync shots: one audio track per visible face, bound by screen position.
 * Multi-person models (LongCat dual-audio, MultiTalk) take exactly this; never pass a mixed track.
 */
export type VideoRequest = {
  plan: RenderPlan; referenceImages: string[]; outPath: string;
  faceTracks: { characterId: string; position: ScreenPosition; audioPath: string }[];
};

export type VideoProvider = {
  name: string;
  capabilities: VideoCapabilities;
  estimateUsd(plan: RenderPlan): number;
  generate(request: VideoRequest): Promise<{ path: string }>;
};

/**
 * Placeholder footage (a moving test pattern, tinted per shot) at the exact planned duration and
 * output format, so editing, timing and QC run without GPU cost. It claims lip-sync for one speaker
 * so the director's lip-sync path is exercised; QC still sends lip-sync to human review.
 */
export const mockVideo: VideoProvider = {
  name: "mock-video",
  capabilities: { maxDurationSec: 10, maxLipSyncSpeakers: 1, perFaceAudio: true, referenceImages: true, nativeAudio: false },
  estimateUsd: () => 0,
  async generate({ plan, outPath }) {
    const { width, height, fps } = config.output;
    const hue = (Number.parseInt(plan.shot.id.replace(/\D/g, "") || "0", 10) * 47) % 360;
    await ffmpeg([
      "-f", "lavfi", "-i", `testsrc2=size=${width}x${height}:rate=${fps}:duration=${plan.durationSec.toFixed(3)}`,
      "-vf", `hue=h=${hue}:s=0.6,format=yuv420p`, "-c:v", "libx264", "-preset", "veryfast", "-an", outPath,
    ]);
    return { path: outPath };
  },
};

export const videoFor = (name: string): VideoProvider => (name === "handoff" ? handoffVideo : mockVideo);
