import { readFileSync } from "node:fs";

const rows = process.argv.slice(2).flatMap((path) =>
  readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line)),
);
const rates = { jev: 0.042, clef: 0.038, decider: 0.02, flash: 0.01 };
for (const [key, group] of Map.groupBy(rows, (row) =>
  [row.split, row.provider, row.arm].join("/"),
)) {
  const accepted = group.filter(({ target }) => target !== null);
  const positive = group.filter(({ expected }) => expected !== null);
  const negative = group.filter(({ expected }) => expected === null);
  const input = group.reduce(
    (sum, row) => sum + row.tokenCalls.reduce((n, [tokens]) => n + tokens, 0),
    0,
  );
  const output = group.reduce(
    (sum, row) => sum + row.tokenCalls.reduce((n, [, tokens]) => n + tokens, 0),
    0,
  );
  const duration = group.map(({ selectionMs }) => selectionMs).sort((a, b) => a - b);
  process.stdout.write(
    JSON.stringify({
      key,
      trials: group.length,
      candidateRecall: [positive.filter(({ recall }) => recall).length, positive.length],
      accepted: accepted.length,
      correctAccepted: accepted.filter(({ expected, target }) => expected === target).length,
      wrongAccepted: accepted.filter(({ expected, target }) => expected !== target).length,
      correctExecution: positive.filter(({ expected, executed }) => expected === executed).length,
      correctAbstentions: negative.filter(({ target, error }) => target === null && !error).length,
      errors: group.filter(({ error }) => error).length,
      medianSelectionMs: duration[Math.ceil(duration.length / 2) - 1],
      inputTokens: input,
      outputTokens: output,
      estimatedUsd: (input * rates[group[0].provider]) / 1_000_000,
    }) + "\n",
  );
}
