import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import OpenAI from "openai";
import { trace } from "@opentelemetry/api";
import type { Action } from "@browserbasehq/stagehand-protocol/types";
import { StagehandLogger } from "../../../../extension/logger.js";
import * as inference from "../../../../extension/inference.js";
import { pickCandidate } from "../../../../extension/services/decisions/pick.js";
import {
  runDecisionsAct,
  type DecisionsActDeps,
} from "../../../../extension/services/decisions/pipeline.js";
import {
  choiceAnswer,
  decide,
  type DecisionModelConfig,
} from "../../../../extension/services/decisions/client.js";
import { generateWithOpenAI } from "../../openaiStructuredGeneration.js";
import { candidates, choosePlan, evidence, type ActionSnapshot } from "./plans.js";
import type { ActTask } from "./tasks.js";
import { archiveSources } from "./archive.js";

const [source, dir] = process.argv.slice(2);
if (!source || !dir) throw new Error("Expected capture and new result directories");
mkdirSync(dir);
const arms = (process.env.ACT_ARMS ?? "known-dual,known-single,plans,legacy,luna").split(",");
const rounds = Number(process.env.ACT_ROUNDS ?? 2);
const provider = process.env.ACT_PROVIDER ?? "perplexity";
if (!["perplexity", "typesafe", "cloudflare"].includes(provider))
  throw new Error("Unsupported decision provider");
const model =
  process.env.ACT_MODEL ??
  (provider === "typesafe"
    ? "jev-1.14.0"
    : provider === "cloudflare"
      ? "clef-flash"
      : "pplx-decider-v1.3");
const llmModel = process.env.AI_GATEWAY_MODEL ?? "openai/gpt-6-luna";
const gateway = new OpenAI({
  baseURL: process.env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1",
  apiKey: process.env.AI_GATEWAY_API_KEY,
  maxRetries: 0,
  timeout: 40_000,
});
const context = new AsyncLocalStorage<{ task: string; arm: string; round: number }>();
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const started = performance.now();
  const response = await realFetch(url, init);
  if (context.getStore() && init?.body && typeof init.body === "string") {
    appendFileSync(
      join(dir, "requests.jsonl"),
      JSON.stringify({
        ...context.getStore(),
        url: typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
        ms: performance.now() - started,
        status: response.status,
        body: JSON.parse(init.body),
        response: await response
          .clone()
          .json()
          .catch(() => null),
      }) + "\n",
    );
  }
  return response;
};
const sha = (data: string) => createHash("sha256").update(data).digest("hex");
type Label = ActTask & { goldIds: string[]; eligibleGold: string[]; available: boolean };
const jobs = readdirSync(source)
  .filter((file) => file.endsWith(".labels.json"))
  .flatMap((file) => {
    const labels: Label[] = JSON.parse(readFileSync(join(source, file), "utf8"));
    const snapshot: ActionSnapshot = JSON.parse(
      readFileSync(join(source, file.replace(".labels", "")), "utf8"),
    );
    return labels
      .filter(
        (label) =>
          label.available &&
          (!process.env.ACT_TASKS || process.env.ACT_TASKS.split(",").includes(label.name)),
      )
      .map((label) => ({ label, snapshot }));
  });
writeFileSync(
  join(dir, "manifest.json"),
  JSON.stringify(
    {
      revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      source,
      sourceManifestHash: sha(readFileSync(join(source, "manifest.json"), "utf8")),
      arms,
      rounds,
      model,
      llmModel,
      concurrency: 3,
      threshold: 0.7,
      jobs: jobs.map(({ label }) => label.name),
      scriptHash: sha(readFileSync(new URL(import.meta.url), "utf8")),
    },
    null,
    2,
  ),
);

archiveSources(dir);
async function run({ label, snapshot }: (typeof jobs)[number], arm: string, round: number) {
  return context.run({ task: label.name, arm, round }, async () => {
    const decisions: object[] = [];
    const calls: object[] = [];
    const config: DecisionModelConfig = {
      provider: provider as DecisionModelConfig["provider"],
      apiKey: (provider === "typesafe"
        ? process.env.TYPESAFE_API_KEY
        : provider === "cloudflare"
          ? process.env.CLOUDFLARE_AUTH_TOKEN
          : process.env.PERPLEXITY_API_KEY)!,
      ...(provider === "cloudflare" ? { accountId: process.env.CLOUDFLARE_ACCOUNT_ID } : {}),
      model,
      recordDecisionUsage: (usage) => decisions.push(usage),
    };
    const logs: object[] = [];
    const logger = new StagehandLogger({ tracer: trace.getTracer("act-replay") }, (log) =>
      logs.push(log),
    );
    const generate = async (params: Parameters<typeof generateWithOpenAI>[2]) => {
      const started = performance.now();
      return generateWithOpenAI(gateway, llmModel, params, (usage) =>
        calls.push({ ms: performance.now() - started, usage }),
      );
    };
    const chosen = candidates(
      snapshot,
      label.instruction,
      label.method === "fill" ? "input" : "pointer",
    );
    let action: { nodeId: string; method: string; arguments: string[] } | undefined;
    let error: string | undefined;
    let confidence: number | undefined;
    const started = performance.now();
    try {
      if (arm.startsWith("known-")) {
        let nodeId: string | undefined;
        if (arm === "known-dual") {
          const result = await pickCandidate(
            {
              config,
              instruction: label.instruction,
              trace: [],
              threshold: 0.7,
              logger,
              ensureTimeRemaining: () => {},
            },
            "target",
            { tree: snapshot.formattedTree, xpathMap: snapshot.xpathMap, nodes: chosen.nodes },
            chosen.selected,
            "Which element matches the user's requested target?",
          );
          nodeId = result.accepted ? result.picked?.id : undefined;
          confidence = result.best;
        } else if (chosen.selected.length) {
          const response = await decide(
            config,
            { instruction: label.instruction },
            {
              target: {
                type: "choice",
                instructions:
                  "Which element uniquely matches the requested target? Choose none_match if the target is absent, disabled, or ambiguous. Do not substitute a similar control.",
                criteria: {
                  ...Object.fromEntries(
                    chosen.selected.map((node) => [
                      node.id,
                      evidence(snapshot, chosen.nodes, node, arm === "known-compact"),
                    ]),
                  ),
                  none_match: "No unique enabled element matches the instruction",
                },
              },
            },
          );
          const answer = choiceAnswer(response, "target");
          confidence = answer.confidence;
          if (confidence >= 0.7 && chosen.selected.some((node) => node.id === answer.choice))
            nodeId = answer.choice;
        }
        if (nodeId)
          action = { nodeId, method: label.method, arguments: label.value ? [label.value] : [] };
      } else if (arm.startsWith("plans")) {
        const result = await choosePlan(config, snapshot, label.instruction, {
          compact: arm !== "plans-full",
          includeDestination: arm !== "plans-nodest",
        });
        confidence = result.confidence;
        if (result.plan) action = result.plan;
      } else if (arm === "legacy") {
        const deps = {
          page: {
            captureSnapshot: async () => ({
              combinedTree: snapshot.formattedTree,
              combinedXpathMap: snapshot.xpathMap,
              combinedUrlMap: snapshot.urlMap,
              combinedEditableIds: snapshot.editableIds,
            }),
            url: () => snapshot.url,
            mainFrame: () => ({}),
          },
          logger,
          instruction: label.instruction,
          snapshotOptions: {},
          ensureTimeRemaining: () => {},
          takeAction: async (candidate: Action) => {
            action = {
              nodeId:
                Object.keys(snapshot.xpathMap).find(
                  (id) => `xpath=${snapshot.xpathMap[id]}` === candidate.selector,
                ) ?? "unknown",
              method: candidate.method,
              arguments: candidate.arguments ?? [],
            };
            return {
              success: true,
              message: "Replay selection only",
              actionDescription: candidate.description,
              actions: [candidate],
            };
          },
        } as unknown as DecisionsActDeps;
        await runDecisionsAct(
          { ...config, llmFallback: false, argumentLlm: false, pageState: false },
          deps,
        );
      } else if (arm !== "luna") throw new Error(`Unknown arm ${arm}`);
      if (arm === "luna") {
        const response = await inference.act({
          instruction: label.instruction,
          domElements: snapshot.formattedTree,
          generate,
        });
        if (response.element)
          action = {
            nodeId: response.element.elementId,
            method: response.element.method,
            arguments: response.element.arguments,
          };
      }
    } catch (cause) {
      error = String(cause);
    }
    const correct = action
      ? label.goldIds.includes(action.nodeId) &&
        action.method === label.method &&
        (label.method !== "fill" || action.arguments[0] === label.value)
      : label.gold === null;
    const row = {
      task: label.name,
      arm,
      round,
      knownOperation: arm.startsWith("known-"),
      passed: !error && correct,
      accepted: Boolean(action),
      wrongAccept: Boolean(action && !correct),
      candidateRecall:
        label.gold === null
          ? null
          : chosen.selected.some((node) => label.goldIds.includes(node.id)),
      candidates: chosen.selected.length,
      action,
      confidence,
      error,
      ms: performance.now() - started,
      decisions,
      calls,
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
        ms: Math.round(row.ms),
      }) + "\n",
    );
  });
}
for (let round = 0; round < rounds; round++) {
  let next = 0;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (next < jobs.length) {
        const index = next++;
        const offset = (index + round) % arms.length;
        for (const arm of [...arms.slice(offset), ...arms.slice(0, offset)])
          await run(jobs[index]!, arm, round);
      }
    }),
  );
}
