import { parseArgs } from "node:util";
import { runProject } from "./pipeline.ts";

const { values } = parseArgs({
  options: {
    project: { type: "string", default: "dragon-cave" },
    idea: { type: "string", default: "A young explorer follows a map into a dragon's cave and discovers the dragon drew it for her." },
    target: { type: "string", default: "20-30" },
    approve: { type: "boolean", default: false },
    regenerate: { type: "string", multiple: true, default: [] },
  },
});

if (!/^[a-z0-9-]+$/.test(values.project)) throw new Error("--project must be lowercase letters, digits and dashes");
const [min, max] = values.target.split("-").map(Number);
if (!(min > 0 && max >= min)) throw new Error("--target must look like 20-30");

const result = await runProject({
  projectId: values.project, idea: values.idea, targetSec: [min, max], approve: values.approve, regenerate: values.regenerate,
});

if (result.status === "waiting") {
  console.log(`WAITING: ${result.requests.length} file(s) needed, listed in ${result.handoffPath}`);
  for (const r of result.requests) console.log(`  ${String(r.kind).padEnd(15)} ${String(r.path)}`);
  process.exit(3);
}

const { finalPath, report, spentUsd } = result;
for (const c of report.checks) console.log(`${c.status.padEnd(18)} ${(c.shotId ?? "").padEnd(5)} ${c.name.padEnd(32)} ${c.detail}`);
console.log(`\n${finalPath}  spent $${spentUsd.toFixed(2)}  ${report.approved ? "APPROVED" : "NOT APPROVED (failures or human review pending)"}`);
