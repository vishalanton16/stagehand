import { readFileSync } from "node:fs";

const rates = {
  clairic: 0.1,
  locate: 0.02,
  "locate-source": 0.02,
  "locate-flash": 0.01,
  "flash-source": 0.01,
};

const rows = process.argv.slice(2).flatMap((file) =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line)),
);
const cases = rows.filter(({ provider }) => provider);
for (const [key, group] of Map.groupBy(cases, (row) =>
  [row.task, row.provider, row.variant].join("/"),
)) {
  const usage = group.flatMap((row) => (row.usage ? [row.usage] : (row.llmUsage ?? [])));
  const sum = (field) => usage.reduce((total, entry) => total + (entry[field] ?? 0), 0);
  const input = sum("inputTokens");
  const output = sum("outputTokens");
  const cached = sum("cachedInputTokens");
  const estimatedUsd =
    (group[0].provider === "luna"
      ? (input - cached) * 0.1 + cached * 0.01 + output * 0.5
      : input * rates[group[0].provider]) / 1_000_000;
  const times = group.map(({ elapsedMs }) => elapsedMs).sort((a, b) => a - b);
  process.stdout.write(
    JSON.stringify({
      key,
      attempts: group.length,
      passed: group.filter(({ passed }) => passed).length,
      metered: group.filter((row) => row.usage || row.llmUsage?.length).length,
      inputTokens: input,
      outputTokens: output,
      estimatedUsd,
      medianMs: times[Math.ceil(times.length / 2) - 1],
    }) + "\n",
  );
}
