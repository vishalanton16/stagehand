import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const percentile = (values, p) =>
  values.toSorted((a, b) => a - b)[Math.ceil(values.length * p) - 1];
for (const dir of process.argv.slice(2)) {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const rows = readFileSync(join(dir, "results.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const summary = [];
  for (const [arm, group] of Map.groupBy(rows, (row) => row.arm)) {
    const decisionRate = manifest.model?.startsWith("jev")
      ? 0.042
      : manifest.model === "clef-flash"
        ? 0.038
        : manifest.model?.startsWith("clef")
          ? 0.24
          : (manifest.decisionModel ?? manifest.model ?? "").includes("flash")
            ? 0.01
            : 0.02;
    let llmInput = 0,
      llmOutput = 0,
      cachedInput = 0,
      decisionInput = 0,
      decisionCalls = 0,
      llmCalls = 0;
    for (const row of group) {
      for (const call of row.calls ?? []) {
        llmCalls++;
        llmInput += call.usage?.inputTokens ?? 0;
        llmOutput += call.usage?.outputTokens ?? 0;
        cachedInput += call.usage?.cachedInputTokens ?? 0;
      }
      for (const call of row.decisions ?? []) {
        decisionCalls++;
        decisionInput += Number(call.inputTokens ?? 0);
      }
    }
    const uncachedCost =
      (llmInput * 0.1 + llmOutput * 0.5 + decisionInput * decisionRate) / 1_000_000;
    const cacheReadEstimate =
      ((llmInput - cachedInput) * 0.1 +
        cachedInput * 0.01 +
        llmOutput * 0.5 +
        decisionInput * decisionRate) /
      1_000_000;
    const times = group.filter((row) => Number.isFinite(row.ms)).map((row) => row.ms);
    const verifiedTimes = group
      .filter((row) => Number.isFinite(row.ms))
      .map((row) => row.ms + (row.outcome?.verificationMs ?? 0));
    summary.push({
      arm,
      trials: group.length,
      passed: group.filter((row) => row.passed).length,
      errors: group.filter((row) => row.error).length,
      wrongAcceptedSelections: group.some((row) => typeof row.wrongAccept === "boolean")
        ? group.filter((row) => row.wrongAccept).length
        : null,
      fallbacks: group.some((row) => typeof row.fallback === "boolean")
        ? group.filter((row) => row.fallback).length
        : null,
      correctDirectActions: group.some((row) => row.outcome || typeof row.accepted === "boolean")
        ? group.filter(
            (row) =>
              row.passed &&
              !row.fallback &&
              (row.outcome?.actionData?.actions?.length > 0 || row.accepted),
          ).length
        : null,
      p50Ms: percentile(times, 0.5),
      p95Ms: percentile(times, 0.95),
      verifiedP50Ms: percentile(verifiedTimes, 0.5),
      verifiedP95Ms: percentile(verifiedTimes, 0.95),
      meanDecisionCalls: decisionCalls / group.length,
      meanLlmCalls: llmCalls / group.length,
      meanInputTokens: (decisionInput + llmInput) / group.length,
      llmInput,
      llmOutput,
      cachedInput,
      decisionInput,
      uncachedUsdPer1000: (uncachedCost * 1000) / group.length,
      cacheReadOnlyUsdPer1000: (cacheReadEstimate * 1000) / group.length,
      uncachedUsdPerSuccessfulTask: group.some((row) => row.passed)
        ? uncachedCost / group.filter((row) => row.passed).length
        : null,
    });
  }
  const output = {
    dir,
    ratesAsOf: "2026-11-15",
    pricingSources: [
      "https://developers.openai.com/api/docs/pricing",
      "https://docs.perplexity.ai/docs/getting-started/pricing",
      "https://docs.typesafe.ai/models",
      "https://developers.cloudflare.com/workers-ai/models/clef-flash/",
    ],
    costLimitations:
      "Token-based estimates, excluding unreported cache-write charges, gateway fees, browser cost and missing usage. Not invoices. Uncached estimates price every input token at the uncached rate.",
    summary,
  };
  writeFileSync(join(dir, "summary.json"), JSON.stringify(output, null, 2));
  process.stdout.write(JSON.stringify(output) + "\n");
}
