import { readFileSync } from "node:fs";

const decisionInputUsdPerMillion = {
  jev: 0.042,
  clef: 0.038,
  decider: 0.02,
  flash: 0.01,
  clairic: 0.1,
  locate: 0.02,
  locateFlash: 0.01,
  judge: 0.042,
};

const samples = process.argv.slice(2).flatMap((path) =>
  readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line)),
);
const groups = Map.groupBy(samples, (sample) => `${sample.task} / ${sample.arm}`);
const sum = (items, value) => items.reduce((total, item) => total + value(item), 0);

for (const [group, rows] of groups) {
  const duration = rows
    .flatMap(({ elapsed }) => (elapsed === undefined ? [] : [elapsed]))
    .sort((a, b) => a - b);
  const percentile = (p) => duration[Math.ceil(duration.length * p) - 1] ?? null;
  const decision = rows.flatMap(({ decisionUsage }) => decisionUsage);
  const llm = rows.flatMap(({ llmUsage }) => llmUsage);
  const estimatedUsd =
    (sum(decision, ([input]) => input) * (decisionInputUsdPerMillion[rows[0].arm] ?? 0) +
      sum(
        llm,
        ([input, output, cached]) => (input - cached) * 0.1 + cached * 0.01 + output * 0.5,
      )) /
    1_000_000;
  process.stdout.write(
    JSON.stringify({
      group,
      attempts: rows.length,
      passed: rows.filter(({ passed }) => passed).length,
      errors: rows.filter(({ error }) => error).length,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      decisionOnlyPasses: rows.filter(
        ({ passed, decisionUsage, llmUsage }) => passed && decisionUsage.length && !llmUsage.length,
      ).length,
      decisionInput: sum(decision, ([input]) => input),
      decisionOutput: sum(decision, ([, output]) => output),
      llmInput: sum(llm, ([input]) => input),
      llmOutput: sum(llm, ([, output]) => output),
      estimatedUsd,
    }) + "\n",
  );
}
