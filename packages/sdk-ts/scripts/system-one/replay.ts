/**
 * Replays extraction arms over the frozen corpus (capture.ts). Every arm sees
 * the identical tree, so differences are the method's, not the page's.
 *
 *   node --env-file=.env --import tsx packages/sdk-ts/scripts/system-one/replay.ts > runs.jsonl
 *
 * REPLAY_ARMS, REPLAY_TASKS (comma lists), REPLAY_ROUNDS, REPLAY_CONCURRENCY.
 */
import { readFileSync } from "node:fs";
import { trace } from "@opentelemetry/api";
import OpenAI from "openai";
import { z } from "zod/v4";
import { StagehandExtractParamsSchema } from "@browserbasehq/stagehand-protocol/schemas";
import { StagehandLogger } from "../../../extension/logger.js";
import * as inference from "../../../extension/inference.js";
import { extractWithClairic } from "../../../extension/services/decisions/clairic.js";
import type { DecisionModelConfig } from "../../../extension/services/decisions/client.js";
import { extractWithDecider } from "../../../extension/services/decisions/decider.js";
import {
  runDecisionsExtract,
  type JsonSchema,
} from "../../../extension/services/decisions/extract.js";
import { parseOutline } from "../../../extension/services/decisions/tree.js";
import { runWithProgress } from "../../../extension/understudy/progress.js";
import { injectUrls, transformSchema } from "../../../extension/utils.js";
import { generateWithOpenAI } from "../openaiStructuredGeneration.js";
import { CORPUS_DIR } from "./capture.js";
import { tasks as devTasks, type CorpusTask } from "./corpus.js";
import { heldoutTasks } from "./heldout.js";
import { heldout2Tasks } from "./heldout2.js";
import { heldout3Tasks } from "./heldout3.js";
import { heldout4Tasks } from "./heldout4.js";

const tasks = [...devTasks, ...heldoutTasks, ...heldout2Tasks, ...heldout3Tasks, ...heldout4Tasks];
import { extraArms } from "./arms.js";

const env = process.env;

export type Frozen = {
  name: string;
  tree: string;
  xpathMap: Record<string, string>;
  urlMap: Record<string, string>;
};

export type Usage = { calls: number; inputTokens: number; outputTokens: number; cachedInputTokens: number };

export type ArmContext = {
  task: CorpusTask;
  frozen: Frozen;
  usage: Usage;
  logger: StagehandLogger;
  /** Arm-specific diagnostics written with the run. */
  notes: unknown[];
};

export type Arm = {
  /** Model family used for the cost estimate. */
  rate: keyof typeof RATES;
  run: (context: ArmContext) => Promise<unknown>;
};

/** Published or previously used USD per million input tokens (output is free for decision models). */
export const RATES = {
  luna: { input: 0.1, cached: 0.01, output: 0.5 },
  jev: { input: 0.042, cached: 0.042, output: 0 },
  clef: { input: 0.038, cached: 0.038, output: 0 },
  decider: { input: 0.02, cached: 0.02, output: 0 },
  flash: { input: 0.01, cached: 0.01, output: 0 },
  clairic: { input: 0.1, cached: 0.1, output: 0 },
};

export const decisionConfigs = {
  jev: { provider: "typesafe", apiKey: env.TYPESAFE_API_KEY! },
  clef: {
    provider: "cloudflare",
    apiKey: env.CLOUDFLARE_AUTH_TOKEN!,
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    model: "clef-flash",
  },
  decider: { provider: "perplexity", apiKey: env.PERPLEXITY_API_KEY!, model: "pplx-decider-latest" },
  flash: {
    provider: "perplexity",
    apiKey: env.PERPLEXITY_API_KEY!,
    model: "pplx-decider-flash-latest",
  },
} satisfies Record<string, DecisionModelConfig>;

export function withUsage(config: DecisionModelConfig, usage: Usage): DecisionModelConfig {
  return {
    ...config,
    recordDecisionUsage: (entry) => {
      usage.calls++;
      usage.inputTokens += entry.inputTokens;
      usage.outputTokens += entry.outputTokens;
    },
  };
}

const gateway = new OpenAI({
  baseURL: env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1",
  apiKey: env.AI_GATEWAY_API_KEY,
  maxRetries: 1,
  timeout: 120_000,
});

export async function lunaExtract(
  { task, usage }: Pick<ArmContext, "task" | "usage">,
  domElements: string,
  urlMap: Record<string, string>,
): Promise<unknown> {
  const [schema, urlPaths] = transformSchema(task.schema, []);
  const response = await inference.extract({
    instruction: task.instruction,
    domElements,
    schema: schema as typeof task.schema,
    generate: (input) =>
      generateWithOpenAI(gateway, env.AI_GATEWAY_MODEL ?? "openai/gpt-6-luna", input, (tokens) => {
        usage.calls++;
        usage.inputTokens += tokens.inputTokens;
        usage.outputTokens += tokens.outputTokens;
        usage.cachedInputTokens += tokens.cachedInputTokens ?? 0;
      }),
  });
  const { metadata: _m, prompt_tokens: _p, completion_tokens: _c, reasoning_tokens: _r, cached_input_tokens: _ci, inference_time_ms: _t, ...data } =
    response as Record<string, unknown>;
  for (const { segments } of urlPaths) injectUrls(data, segments, urlMap);
  return data;
}

function nativeExtract(provider: "clairic" | "locate" | "flash") {
  return async ({ task, frozen, usage }: ArmContext) => {
    const params = StagehandExtractParamsSchema.parse({
      pageId: "replay",
      instruction: task.instruction,
      schema: z.toJSONSchema(task.schema),
    });
    const response = await runWithProgress({ name: "extract", timeout: 60_000 }, (progress) => {
      const common = {
        params,
        systemPrompt: "",
        progress,
        recordUsage: (entry: { inputTokens: number; outputTokens: number }) => {
          usage.calls++;
          usage.inputTokens += entry.inputTokens;
          usage.outputTokens += entry.outputTokens;
        },
        page: {
          captureSnapshot: async () => ({
            combinedTree: frozen.tree,
            combinedXpathMap: frozen.xpathMap,
            combinedUrlMap: frozen.urlMap,
          }),
          screenshot: async () => {
            throw new Error("Text replay");
          },
        },
      };
      return provider === "clairic"
        ? extractWithClairic({
            ...common,
            model: {
              apiKey: env.CLOUDFLARE_AUTH_TOKEN!,
              accountId: env.CLOUDFLARE_ACCOUNT_ID!,
            },
          } as Parameters<typeof extractWithClairic>[0])
        : extractWithDecider({
            ...common,
            model: {
              apiKey: env.PERPLEXITY_API_KEY!,
              modelName: provider === "locate" ? "pplx-decider-latest" : "pplx-decider-flash-latest",
            },
          } as Parameters<typeof extractWithDecider>[0]);
    });
    return response.data;
  };
}

function pickExtract(model: keyof typeof decisionConfigs) {
  return async ({ task, frozen, usage, logger }: ArmContext) => {
    const outcome = await runDecisionsExtract(withUsage(decisionConfigs[model], usage), {
      logger,
      instruction: task.instruction,
      schema: z.toJSONSchema(task.schema) as JsonSchema,
      snap: { tree: frozen.tree, xpathMap: frozen.xpathMap, nodes: parseOutline(frozen.tree) },
      urlMap: frozen.urlMap,
      ensureTimeRemaining: () => {},
      gate: false,
    });
    if (outcome.kind === "fallback") throw new Error(`fallback:${outcome.reason}`);
    return outcome.data;
  };
}

export const arms: Record<string, Arm> = {
  luna: { rate: "luna", run: (context) => lunaExtract(context, context.frozen.tree, context.frozen.urlMap) },
  "pick-jev": { rate: "jev", run: pickExtract("jev") },
  "pick-clef": { rate: "clef", run: pickExtract("clef") },
  "pick-decider": { rate: "decider", run: pickExtract("decider") },
  "pick-flash": { rate: "flash", run: pickExtract("flash") },
  clairic: { rate: "clairic", run: nativeExtract("clairic") },
  locate: { rate: "decider", run: nativeExtract("locate") },
  "locate-flash": { rate: "flash", run: nativeExtract("flash") },
  ...extraArms,
};

export function cost(rate: keyof typeof RATES, usage: Usage): number {
  const r = RATES[rate];
  return (
    ((usage.inputTokens - usage.cachedInputTokens) * r.input +
      usage.cachedInputTokens * r.cached +
      usage.outputTokens * r.output) /
    1_000_000
  );
}

export function loadFrozen(name: string): Frozen {
  return JSON.parse(readFileSync(new URL(`${name}.json`, CORPUS_DIR), "utf8"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const logger = new StagehandLogger({ tracer: trace.getTracer("replay") }, () => {}, undefined, "off");
  const armNames = env.REPLAY_ARMS?.split(",") ?? Object.keys(arms);
  const taskNames = env.REPLAY_TASKS?.split(",");
  const rounds = Number(env.REPLAY_ROUNDS ?? 1);
  const concurrency = Number(env.REPLAY_CONCURRENCY ?? 6);
  const jobs: (() => Promise<void>)[] = [];
  for (let round = 0; round < rounds; round++) {
    for (const task of tasks) {
      if (taskNames && !taskNames.includes(task.name)) continue;
      let frozen: Frozen;
      try {
        frozen = loadFrozen(task.name);
      } catch {
        continue;
      }
      for (const armName of armNames) {
        const arm = arms[armName];
        if (!arm) throw new Error(`Unknown arm ${armName}`);
        jobs.push(async () => {
          const usage: Usage = { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
          const start = performance.now();
          let data: unknown;
          let error: string | undefined;
          const notes: unknown[] = [];
          try {
            data = await arm.run({ task, frozen, usage, logger, notes });
          } catch (err) {
            error = (err instanceof Error ? err.message : String(err)).slice(0, 300);
          }
          const failure = error ?? task.grade(data ?? {});
          process.stdout.write(
            JSON.stringify({
              task: task.name,
              kind: task.kind,
              arm: armName,
              round,
              passed: failure === undefined,
              failure,
              errored: error !== undefined,
              ms: Math.round(performance.now() - start),
              treeChars: frozen.tree.length,
              usage,
              usd: (notes.find((note) => (note as { step?: string })?.step === "cost") as { usd?: number } | undefined)?.usd ?? cost(arm.rate, usage),
              data,
              notes,
            }) + "\n",
          );
        });
      }
    }
  }
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < jobs.length) await jobs[next++]!();
    }),
  );
}
