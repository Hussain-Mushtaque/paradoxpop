import { readFile } from "node:fs/promises";
import { config } from "../config.ts";
import { fileLlm } from "./handoff.ts";

export type LlmProvider = {
  name: string;
  /** Returns the model's text reply; callers parse and validate it. */
  complete(system: string, user: string): Promise<{ text: string; costUsd: number }>;
};

export const mockLlm: LlmProvider = {
  name: "mock-llm",
  async complete() {
    return { text: await readFile(new URL("../../stories/dragon-cave.json", import.meta.url), "utf8"), costUsd: 0 };
  },
};

// Meta Model API, OpenAI-compatible chat completions. Prices from dev.meta.ai/docs/pricing-rate-limits (Oct 2026).
const META_PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  "muse-spark-1.3": { input: 1.25, output: 4.25 },
  "muse-spark-1.3-contributor": { input: 0.1, output: 0.2 },
};

export function metaLlm(model = config.llmModel): LlmProvider {
  const apiKey = process.env.MODEL_API_KEY;
  if (!apiKey) throw new Error("MODEL_API_KEY is not set (see .env.example)");
  const price = META_PRICE_PER_MTOK[model];
  if (!price) throw new Error(`No price configured for ${model}; add it before spending money on it`);
  return {
    name: `meta:${model}`,
    async complete(system, user) {
      const response = await fetch("https://api.meta.ai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(5 * 60_000),
      });
      if (!response.ok) throw new Error(`Meta Model API ${response.status}: ${(await response.text()).slice(0, 300)}`);
      const data = (await response.json()) as {
        choices: { message: { content: string } }[];
        usage: { prompt_tokens: number; completion_tokens: number };
      };
      const costUsd = (data.usage.prompt_tokens * price.input + data.usage.completion_tokens * price.output) / 1e6;
      return { text: data.choices[0].message.content, costUsd };
    },
  };
}

export const llmFor = (name: string, screenplayInput: string): LlmProvider =>
  name === "meta" ? metaLlm() : name === "file" ? fileLlm(screenplayInput) : mockLlm;
