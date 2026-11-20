export type RowOutcome = {
  id: string;
  operation: string;
  arm: string;
  round: number;
  status: "pass" | "wrong" | "failed" | "error" | "invalid";
  route: "ordinary" | "direct" | "fallback" | "undetermined" | "unstarted";
  sdkMs?: number;
  decisionReceipts: unknown[];
  lunaCalls: unknown[];
  wrongEffect?: boolean;
};

export function summarize(rows: RowOutcome[]) {
  const arms = new Set(rows.map((row) => row.arm));
  const pairs = new Map<string, RowOutcome[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.id, row.round]);
    const pair = pairs.get(key) ?? [];
    pair.push(row);
    pairs.set(key, pair);
  }
  const paired = [...pairs.values()]
    .filter((pair) => pair.length === arms.size && pair.every((row) => row.status !== "invalid"))
    .flat();

  const nearestRank = (sorted: number[], percentile: number) =>
    sorted[Math.ceil(sorted.length * percentile) - 1] ?? null;
  return [...arms].flatMap((arm) =>
    ["all", "observe", "extract", "act"].map((operation) => {
      const matches = (row: RowOutcome) =>
        row.arm === arm && (operation === "all" || row.operation === operation);
      const sample = paired.filter(matches);
      const times = sample.flatMap((row) => row.sdkMs ?? []).sort((a, b) => a - b);
      return {
        arm,
        operation,
        paired: sample.length,
        excluded: rows.filter(matches).length - sample.length,
        passed: sample.filter((row) => row.status === "pass").length,
        wrongAccepted: sample.filter((row) => row.status === "wrong").length,
        directWrongAccepted: sample.filter(
          (row) => row.status === "wrong" && row.route === "direct",
        ).length,
        wrongEffect: sample.filter((row) => row.wrongEffect).length,
        failed: sample.filter((row) => row.status === "failed").length,
        errors: sample.filter((row) => row.status === "error").length,
        fallbacks: sample.filter((row) => row.route === "fallback").length,
        direct: sample.filter((row) => row.route === "direct").length,
        decisionReceipts: sample.reduce((sum, row) => sum + row.decisionReceipts.length, 0),
        lunaCalls: sample.reduce((sum, row) => sum + row.lunaCalls.length, 0),
        timed: times.length,
        p50Ms: nearestRank(times, 0.5),
        p95Ms: nearestRank(times, 0.95),
      };
    }),
  );
}
