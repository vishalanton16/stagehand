/**
 * Replays extraction arms over the frozen corpus (capture.ts). Every arm sees
 * the identical tree, so differences are the method's, not the page's.
 *
 *   node --env-file=.env --import tsx packages/sdk-ts/scripts/system-one/replay.ts > runs.jsonl
 *
 * REPLAY_ARMS, REPLAY_TASKS (comma lists), REPLAY_ROUNDS, REPLAY_CONCURRENCY.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { trace } from "@opentelemetry/api";
import OpenAI from "openai";
import { z } from "zod/v4";
import { StagehandExtractParamsSchema } from "@browserbasehq/stagehand-protocol/schemas";
import { StagehandLogger } from "../../../extension/logger.js";
import * as inference from "../../../extension/inference.js";
import { extractWithClairic } from "./experiments/clairic.js";
import type { DecisionModelConfig } from "../../../extension/services/decisions/client.js";
import { extractWithDecider } from "./experiments/decider.js";
import type { JsonSchema } from "./mapCopy.js";
import { baselineModule } from "./baseline.js";
const { runDecisionsExtract } = await baselineModule("services/decisions/extract");
import { parseOutline } from "../../../extension/services/decisions/tree.js";
import { runWithProgress } from "../../../extension/understudy/progress.js";
import { injectUrls, transformSchema } from "../../../extension/utils.js";
import { generateWithOpenAI } from "../openaiStructuredGeneration.js";
import { CORPUS_DIR, corpusTasks } from "./capture.js";
import type { CorpusTask } from "./corpus.js";
import { extraArms, oracleArm } from "./arms.js";

const env = process.env;

export type Frozen = {
  name: string;
  tree: string;
  xpathMap: Record<string, string>;
  urlMap: Record<string, string>;
};

export type Usage = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
};

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
  decider: {
    provider: "perplexity",
    apiKey: env.PERPLEXITY_API_KEY!,
    model: "pplx-decider-v1.3",
  },
  flash: {
    provider: "perplexity",
    apiKey: env.PERPLEXITY_API_KEY!,
    model: "pplx-decider-flash-v1.3",
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

export const gateway = new OpenAI({
  baseURL: env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1",
  apiKey: env.AI_GATEWAY_API_KEY,
  maxRetries: 1,
  timeout: 120_000,
});

export async function lunaExtract(
  { task, usage }: Pick<ArmContext, "task" | "usage">,
  domElements: string,
  urlMap: Record<string, string>,
  guardMissing = true,
): Promise<unknown> {
  const [schema, urlPaths] = transformSchema(task.schema, []);
  const { data } = await inference.extract({
    instruction: task.instruction,
    ...(guardMissing
      ? {
          userProvidedInstructions:
            "For optional fields, omit the field when the supplied page does not contain the requested fact. Absence is not zero. Return zero only if the page explicitly reports zero for that fact. Do not infer values from outside knowledge.",
        }
      : {}),
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
              modelName:
                provider === "locate" ? "pplx-decider-latest" : "pplx-decider-flash-latest",
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
  luna: {
    rate: "luna",
    run: (context) => lunaExtract(context, context.frozen.tree, context.frozen.urlMap, false),
  },
  "luna-guarded": {
    rate: "luna",
    run: (context) => lunaExtract(context, context.frozen.tree, context.frozen.urlMap),
  },
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
  const logger = new StagehandLogger(
    { tracer: trace.getTracer("replay") },
    () => {},
    undefined,
    "off",
  );
  const armNames = env.REPLAY_ARMS?.split(",") ?? Object.keys(arms);
  const availableArms: Record<string, Arm> = { ...arms, "runtime-decider-v13-oracle": oracleArm };
  const taskNames = env.REPLAY_TASKS?.split(",");
  const rounds = Number(env.REPLAY_ROUNDS ?? 1);
  const concurrency = Number(env.REPLAY_CONCURRENCY ?? 6);
  for (const [name, value] of Object.entries({ rounds, concurrency })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name}: ${value}`);
  }
  for (const name of taskNames ?? []) {
    if (!corpusTasks.some((task) => task.name === name)) throw new Error(`Unknown task ${name}`);
  }
  for (const name of armNames) {
    if (!availableArms[name]) throw new Error(`Unknown arm ${name}`);
  }
  const selectedTasks = corpusTasks.filter((task) => !taskNames || taskNames.includes(task.name));
  const snapshots = new Map(selectedTasks.map((task) => [task.name, loadFrozen(task.name)]));
  const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const sourcePaths = execFileSync(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "packages/extension",
      "packages/sdk-ts/scripts",
      "packages/protocol",
      "pnpm-lock.yaml",
    ],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter((path) => path && existsSync(path));
  const sources = Object.fromEntries(
    [...new Set(sourcePaths)].sort().map((path) => [path, readFileSync(path).toString("base64")]),
  );
  const sourceHash = hash(JSON.stringify(sources));
  const run = {
    id: randomUUID(),
    startedAt: new Date().toISOString(),
    revision,
    sourceHash,
    sourceEncoding: "base64",
    dirty: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0,
    rounds,
    concurrency,
    tasks: selectedTasks.map((task) => task.name),
    arms: armNames,
    fallbackModel: env.AI_GATEWAY_MODEL ?? "openai/gpt-6-luna",
  };
  const archive = new URL(`runs/archive/${run.id}/`, CORPUS_DIR);
  mkdirSync(archive, { recursive: true });
  writeFileSync(new URL("manifest.json", archive), JSON.stringify(run, null, 2) + "\n");
  writeFileSync(new URL("sources.json.gz", archive), gzipSync(JSON.stringify(sources)));
  writeFileSync(
    new URL("snapshots.json.gz", archive),
    gzipSync(JSON.stringify(Object.fromEntries(snapshots))),
  );
  process.stderr.write(JSON.stringify({ run }) + "\n");
  const jobs: (() => Promise<void>)[] = [];
  for (let round = 0; round < rounds; round++) {
    for (const task of selectedTasks) {
      const frozen = snapshots.get(task.name)!;
      const snapshotHash = hash(JSON.stringify(frozen));
      for (const armName of armNames) {
        const arm = availableArms[armName];
        if (!arm) throw new Error(`Unknown arm ${armName}`);
        jobs.push(async () => {
          const usage: Usage = { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
          const start = performance.now();
          let data: unknown;
          let error: string | undefined;
          const notes: unknown[] = [];
          const runLogger = new StagehandLogger(
            logger.tracing,
            (event) => {
              if (event.data.category === "decisions" || event.data.category === "decisions-usage")
                notes.push(event);
            },
            undefined,
            env.REPLAY_DEBUG === "1" ? "debug" : "info",
          );
          try {
            data = await arm.run({ task, frozen, usage, logger: runLogger, notes });
          } catch (err) {
            error = (err instanceof Error ? err.message : String(err)).slice(0, 300);
          }
          const failure = error ?? task.grade(data ?? {});
          const costNote = notes.find((note) => (note as { step?: string })?.step === "cost") as
            | { usd: number | null }
            | undefined;
          const line =
            JSON.stringify({
              run,
              snapshotHash,
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
              usd: costNote
                ? costNote.usd
                : armName.startsWith("runtime-")
                  ? null
                  : cost(arm.rate, usage),
              data,
              notes,
            }) + "\n";
          appendFileSync(new URL("results.jsonl", archive), line);
          process.stdout.write(line);
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
