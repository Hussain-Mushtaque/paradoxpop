import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { log } from "./log.ts";

export type Store = ReturnType<typeof openStore>;

export function openStore(path: string) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (project_id TEXT, kind TEXT, body TEXT, updated_at TEXT, PRIMARY KEY (project_id, kind));
    CREATE TABLE IF NOT EXISTS jobs (
      key TEXT PRIMARY KEY, project_id TEXT, stage TEXT, provider TEXT, status TEXT,
      input TEXT, output TEXT, error TEXT, attempts INTEGER DEFAULT 0, cost_usd REAL DEFAULT 0, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS spend (project_id TEXT, provider TEXT, stage TEXT, cost_usd REAL, at TEXT);
  `);

  const now = () => new Date().toISOString();

  return {
    saveDoc(projectId: string, kind: string, body: unknown) {
      db.prepare("INSERT OR REPLACE INTO documents VALUES (?, ?, ?, ?)").run(projectId, kind, JSON.stringify(body), now());
    },
    loadDoc<T>(projectId: string, kind: string): T | undefined {
      const row = db.prepare("SELECT body FROM documents WHERE project_id = ? AND kind = ?").get(projectId, kind) as { body: string } | undefined;
      return row ? (JSON.parse(row.body) as T) : undefined;
    },
    spent(projectId?: string): number {
      const row = (projectId
        ? db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM spend WHERE project_id = ?").get(projectId)
        : db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM spend").get()) as { total: number };
      return row.total;
    },
    jobs(projectId: string) {
      return db.prepare("SELECT key, stage, provider, status, attempts, cost_usd, error FROM jobs WHERE project_id = ? ORDER BY updated_at").all(projectId);
    },

    /**
     * Runs a unit of work once. A job whose inputs hash matches a finished job, and whose output
     * file still exists, is skipped, which is what makes a failed run resumable.
     */
    async job<T extends { path: string; costUsd?: number }>(opts: {
      projectId: string; stage: string; provider: string; input: unknown; estimateUsd: number;
      budget: { limitUsd: number }; retries?: number; timeoutMs?: number; work: () => Promise<T>;
    }): Promise<T> {
      const key = createHash("sha256").update(JSON.stringify([opts.projectId, opts.stage, opts.provider, opts.input])).digest("hex").slice(0, 24);
      const existing = db.prepare("SELECT status, output FROM jobs WHERE key = ?").get(key) as { status: string; output: string } | undefined;
      if (existing?.status === "done") {
        const output = JSON.parse(existing.output) as T;
        if (existsSync(output.path)) return output;
      }
      if (this.spent() + opts.estimateUsd > opts.budget.limitUsd) {
        throw new Error(`Spending limit reached: ${this.spent().toFixed(2)} + ${opts.estimateUsd.toFixed(2)} > ${opts.budget.limitUsd} USD (${opts.stage})`);
      }
      db.prepare("INSERT OR REPLACE INTO jobs (key, project_id, stage, provider, status, input, attempts, updated_at) VALUES (?, ?, ?, ?, 'running', ?, 0, ?)")
        .run(key, opts.projectId, opts.stage, opts.provider, JSON.stringify(opts.input), now());

      const retries = opts.retries ?? 2;
      for (let attempt = 1; ; attempt++) {
        try {
          const output = await withTimeout(opts.work(), opts.timeoutMs ?? 30 * 60_000);
          const cost = output.costUsd ?? opts.estimateUsd;
          db.prepare("UPDATE jobs SET status = 'done', output = ?, attempts = ?, cost_usd = ?, error = NULL, updated_at = ? WHERE key = ?")
            .run(JSON.stringify(output), attempt, cost, now(), key);
          if (cost > 0) db.prepare("INSERT INTO spend VALUES (?, ?, ?, ?, ?)").run(opts.projectId, opts.provider, opts.stage, cost, now());
          return output;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          db.prepare("UPDATE jobs SET status = 'failed', error = ?, attempts = ?, updated_at = ? WHERE key = ?").run(message, attempt, now(), key);
          log("warn", "job failed", { stage: opts.stage, provider: opts.provider, attempt, error: message });
          if (attempt > retries) throw error;
          await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
        }
      }
    },
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
