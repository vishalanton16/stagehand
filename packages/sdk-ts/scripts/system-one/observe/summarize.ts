import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2];
if (!dir) throw new Error("Expected run directory");
const rows = readFileSync(join(dir, "results.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const summaries: {
  arm: string;
  workload: string;
  runs: number;
  passed: number;
  wrongAccept: number;
  direct: number;
  fallback: number;
  falseEmpty: number;
  errors: number;
  p50: number;
  p95: number;
  meanInputTokens: number;
}[] = [];
for (const arm of new Set(rows.map((r) => r.arm)))
  for (const workload of ["overall", ...new Set(rows.map((r) => r.workload))]) {
    const r = rows.filter(
      (row) => row.arm === arm && (workload === "overall" || row.workload === workload),
    );
    if (!r.length) continue;
    const times = r.map((row) => row.ms).sort((a, b) => a - b);
    const percentile = (p: number) => times[Math.ceil(times.length * p) - 1];
    summaries.push({
      arm,
      workload,
      runs: r.length,
      passed: r.filter((x) => x.passed).length,
      wrongAccept: r.filter((x) => x.wrongAccept).length,
      direct: r.filter((x) => x.accepted).length,
      fallback: r.filter((x) => x.fallback).length,
      falseEmpty: r.filter((x) => x.falseEmpty).length,
      errors: r.filter((x) => x.error).length,
      p50: percentile(0.5),
      p95: percentile(0.95),
      meanInputTokens:
        r.reduce(
          (sum, row) =>
            sum + [...row.decisions, ...row.llm].reduce((n, u) => n + (u.inputTokens ?? 0), 0),
          0,
        ) / r.length,
    });
  }
writeFileSync(join(dir, "summary.json"), JSON.stringify(summaries, null, 2));
for (const s of summaries.filter((s) => s.workload === "overall"))
  process.stdout.write(JSON.stringify(s) + "\n");
