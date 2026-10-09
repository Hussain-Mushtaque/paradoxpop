import { config } from "../config.ts";
import { ffmpeg } from "../ff.ts";
import type { RenderPlan, VideoCapabilities } from "../types.ts";

export type VideoRequest = { plan: RenderPlan; referenceImages: string[]; dialogueAudioPath?: string; outPath: string };

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
  capabilities: { maxDurationSec: 10, maxLipSyncSpeakers: 1, referenceImages: true, nativeAudio: false },
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

export const videoFor = (_name: string): VideoProvider => mockVideo;
