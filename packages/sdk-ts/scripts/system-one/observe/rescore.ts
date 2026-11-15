import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { archive, grade, hash, type ObserveLabel, type ObserveSnapshot } from "./common.js";
const [source, old, dir] = process.argv.slice(2);
if (!source || !old || !dir)
  throw new Error("Expected revised captures, original results and new output directory");
mkdirSync(dir);
const jobs = new Map<string, { label: ObserveLabel; snapshot: ObserveSnapshot }>();
for (const file of readdirSync(source).filter((f) => f.endsWith(".labels.json"))) {
  const snapshot: ObserveSnapshot = JSON.parse(
    readFileSync(join(source, file.replace(".labels", "")), "utf8"),
  );
  for (const label of JSON.parse(readFileSync(join(source, file), "utf8")) as ObserveLabel[])
    jobs.set(label.name, { label, snapshot });
}
const rows = readFileSync(join(old, "results.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => {
    const row = JSON.parse(line);
    const job = jobs.get(row.task)!;
    const grading = grade(row.actions, job.label, job.snapshot);
    return {
      ...row,
      ...grading,
      originalPassed: row.passed,
      passed: !row.error && grading.passed,
      wrongAccept: row.accepted && !grading.passed,
    };
  });
writeFileSync(join(dir, "results.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
archive(dir, {
  kind: "observe-offline-rescore",
  source,
  originalResults: old,
  originalResultsHash: hash(readFileSync(join(old, "results.jsonl"))),
  labelsManifestHash: hash(readFileSync(join(source, "manifest.json"))),
  newInference: false,
  graderVersion: 2,
});
for (const arm of new Set(rows.map((r) => r.arm))) {
  const r = rows.filter((row) => row.arm === arm);
  process.stdout.write(
    JSON.stringify({
      arm,
      runs: r.length,
      passed: r.filter((x) => x.passed).length,
      wrongAccept: r.filter((x) => x.wrongAccept).length,
      fallback: r.filter((x) => x.fallback).length,
    }) + "\n",
  );
}
