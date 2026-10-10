const num = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
};

export const config = {
  llm: process.env.PARADOXPOP_LLM ?? "mock",
  llmModel: process.env.PARADOXPOP_LLM_MODEL ?? "muse-spark-1.3",
  voice: process.env.PARADOXPOP_VOICE ?? "mock",
  video: process.env.PARADOXPOP_VIDEO ?? "mock",
  lipsync: process.env.PARADOXPOP_LIPSYNC ?? "off",
  budgetUsd: num("PARADOXPOP_BUDGET_USD", 5),
  approvalThresholdUsd: num("PARADOXPOP_APPROVAL_THRESHOLD_USD", 1),
  output: { width: 1080, height: 1920, fps: 24 },
  loudnessLufs: -14,
  projectsDir: process.env.PARADOXPOP_PROJECTS_DIR ?? "projects",
};
