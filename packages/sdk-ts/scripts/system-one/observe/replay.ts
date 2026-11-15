import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import OpenAI from "openai";
import { trace } from "@opentelemetry/api";
import type { Action } from "@browserbasehq/stagehand-protocol/types";
import { StagehandLogger } from "../../../../extension/logger.js";
import { observe } from "../../../../extension/services/observeService.js";
import type { DecisionModelConfig } from "../../../../extension/services/decisions/client.js";
import { generateWithOpenAI } from "../../openaiStructuredGeneration.js";
import { baselineModule, BASELINE_REVISION } from "../baseline.js";
import { archive, grade, hash, type ObserveLabel, type ObserveSnapshot } from "./common.js";

const { runDecisionsObserve } = await baselineModule("services/decisions/observe");
const [source, dir] = process.argv.slice(2);
if (!source || !dir) throw new Error("Expected capture directory and new result directory");
mkdirSync(dir);
const arms = (process.env.OBSERVE_ARMS ?? "legacy,luna").split(",");
const rounds = Number(process.env.OBSERVE_ROUNDS ?? 2);
const concurrency = Number(process.env.OBSERVE_CONCURRENCY ?? 2);
const provider = (process.env.OBSERVE_PROVIDER ?? "perplexity") as DecisionModelConfig["provider"];
const model =
  process.env.OBSERVE_MODEL ??
  (provider === "typesafe"
    ? "jev-1.14.0"
    : provider === "cloudflare"
      ? "clef"
      : "pplx-decider-v1.3");
const llmModel = "openai/gpt-6-luna";
const gateway = new OpenAI({
  baseURL: process.env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1",
  apiKey: process.env.AI_GATEWAY_API_KEY,
  maxRetries: 0,
  timeout: 45000,
});
const config: DecisionModelConfig = {
  provider,
  model,
  apiKey: (provider === "typesafe"
    ? process.env.TYPESAFE_API_KEY
    : provider === "cloudflare"
      ? process.env.CLOUDFLARE_AUTH_TOKEN
      : process.env.PERPLEXITY_API_KEY)!,
  ...(provider === "cloudflare" ? { accountId: process.env.CLOUDFLARE_ACCOUNT_ID } : {}),
};
const jobs = readdirSync(source)
  .filter((f) => f.endsWith(".labels.json"))
  .flatMap((file) => {
    const labels: ObserveLabel[] = JSON.parse(readFileSync(join(source, file), "utf8"));
    const snapshot: ObserveSnapshot = JSON.parse(
      readFileSync(join(source, file.replace(".labels", "")), "utf8"),
    );
    return labels
      .filter(
        (l) =>
          l.available &&
          (!process.env.OBSERVE_TASKS || process.env.OBSERVE_TASKS.split(",").includes(l.name)),
      )
      .map((label) => ({ label, snapshot }));
  });
archive(dir, {
  kind: "observe-replay",
  source,
  sourceManifestHash: hash(readFileSync(join(source, "manifest.json"))),
  baselineRevision: BASELINE_REVISION,
  arms,
  rounds,
  concurrency,
  provider,
  model,
  llmModel,
  cache: false,
  jobs: jobs.map((j) => j.label.name),
});
const context = new AsyncLocalStorage<{ task: string; arm: string; round: number }>();
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const started = performance.now();
  const response = await originalFetch(input, init);
  if (context.getStore() && typeof init?.body === "string")
    appendFileSync(
      join(dir, "requests.jsonl"),
      JSON.stringify({
        ...context.getStore(),
        url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        ms: performance.now() - started,
        status: response.status,
        body: JSON.parse(init.body),
        response: await response
          .clone()
          .json()
          .catch(() => null),
      }) + "\n",
    );
  return response;
};

async function run(job: (typeof jobs)[number], arm: string, round: number) {
  return context.run({ task: job.label.name, arm, round }, async () => {
    const { label, snapshot } = job;
    const decisions: object[] = [],
      llm: object[] = [],
      logs: object[] = [];
    const logger = new StagehandLogger({ tracer: trace.getTracer("observe-replay") }, (log) =>
      logs.push(log),
    );
    const page = {
      captureSnapshot: async () => ({
        combinedTree: snapshot.formattedTree,
        combinedXpathMap: snapshot.xpathMap,
        combinedUrlMap: snapshot.urlMap,
        combinedEditableIds: snapshot.editableIds,
      }),
    };
    const ordinary = async () =>
      (
        await observe({
          params: {
            pageId: "frozen-page",
            instruction: label.instruction,
            options: { cache: false, timeout: 45000 },
          },
          page: page as never,
          logger,
          model: { source: "client" },
          clientLLMGenerate: (params) =>
            generateWithOpenAI(gateway, llmModel, params, (usage) => llm.push(usage)),
        })
      ).data;
    let actions: Action[] = [],
      fallback = false,
      reason: string | undefined,
      error: string | undefined;
    const started = performance.now();
    try {
      if (arm === "luna") actions = await ordinary();
      else {
        const scopedConfig = {
          ...config,
          recordDecisionUsage: (usage: object) => decisions.push(usage),
        };
        const outcome =
          arm === "legacy"
            ? await runDecisionsObserve(scopedConfig, {
                page,
                logger,
                instruction: label.instruction,
                snapshotOptions: {},
                ensureTimeRemaining: () => {
                  if (performance.now() - started > 45000) throw new Error("Replay deadline");
                },
              })
            : arm === "runtime"
              ? await (
                  await import("../../../../extension/services/decisions/observeSelection.js")
                ).selectObservation(scopedConfig, snapshot, label.instruction)
              : await (
                  await import("./policy.js")
                ).resolveObservation(scopedConfig, snapshot, label.instruction, arm);
        if (outcome.kind === "done") actions = outcome.actions;
        else {
          fallback = true;
          reason = outcome.reason;
          actions = await ordinary();
        }
      }
    } catch (e) {
      error = String(e);
    }
    const grading = grade(actions, label, snapshot);
    const row = {
      task: label.name,
      workload: label.workload,
      arm,
      round,
      ...grading,
      passed: !error && grading.passed,
      accepted: arm !== "luna" && !fallback && !error,
      wrongAccept: arm !== "luna" && !fallback && !error && !grading.passed,
      fallback,
      reason,
      error,
      ms: performance.now() - started,
      actions,
      decisions,
      llm,
      logs,
    };
    appendFileSync(join(dir, "results.jsonl"), JSON.stringify(row) + "\n");
    process.stdout.write(
      JSON.stringify({
        task: label.name,
        arm,
        round,
        passed: row.passed,
        wrongAccept: row.wrongAccept,
        fallback,
        reason,
        error,
        ms: Math.round(row.ms),
        missing: grading.missing.length,
        extra: grading.extra.length,
      }) + "\n",
    );
  });
}
for (let round = 0; round < rounds; round++) {
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < jobs.length) {
        const index = next++;
        const offset = (index + round) % arms.length;
        for (const arm of [...arms.slice(offset), ...arms.slice(0, offset)])
          await run(jobs[index]!, arm, round);
      }
    }),
  );
}
