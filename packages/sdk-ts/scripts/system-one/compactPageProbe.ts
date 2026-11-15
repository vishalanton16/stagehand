import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { trace } from "@opentelemetry/api";
import OpenAI from "openai";
import { z } from "zod/v4";
import type { LLMGenerateParams, LLMGenerateResult } from "@browserbasehq/stagehand-protocol/types";
import { StagehandLogger } from "../../../extension/logger.js";
import { extract } from "../../../extension/services/extractService.js";
import { generateWithOpenAI } from "../openaiStructuredGeneration.js";
import { compactPageTasks } from "./compactPageTasks.js";

const [snapshotDir, dir] = process.argv.slice(2);
if (!snapshotDir || !dir)
  throw new Error("Expected the snapshot directory and a new output directory");
mkdirSync(dir);
const fallbackModel = process.env.AI_GATEWAY_MODEL ?? "openai/gpt-6-luna";
const decisionModel = "pplx-decider-v1.3";
const gateway = new OpenAI({
  baseURL: process.env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1",
  apiKey: process.env.AI_GATEWAY_API_KEY,
  timeout: 45_000,
  maxRetries: 0,
});
const tracer = trace.getTracer("compact-page-probe");
const decisionConfig = {
  provider: "perplexity",
  apiKey: process.env.PERPLEXITY_API_KEY!,
  model: decisionModel,
} as const;
const arms = ["luna", "luna-compact", "decider-compact"] as const;
const rounds = 3;
const concurrency = 4;
const tasks = compactPageTasks.map((task) => {
  const raw = readFileSync(join(snapshotDir, task.name + ".json"));
  const snapshot = JSON.parse(raw.toString()) as {
    tree: string;
    urlMap: Record<string, string>;
    xpathMap: Record<string, string>;
    url: string;
  };
  return {
    task,
    snapshot,
    schema: z.json().parse(z.toJSONSchema(task.schema)),
    hash: createHash("sha256").update(raw).digest("hex"),
  };
});

writeFileSync(
  join(dir, "manifest.json"),
  JSON.stringify(
    {
      arms,
      rounds,
      concurrency,
      fallbackModel,
      decisionModel,
      tasks: tasks.map(({ task, snapshot, schema, hash }) => ({
        name: task.name,
        category: task.category,
        url: snapshot.url,
        instruction: task.instruction,
        expected: task.expected,
        schema,
        hash,
      })),
    },
    null,
    2,
  ),
);

type Usage = NonNullable<LLMGenerateResult["usage"]>;
type ModelCall = { name: string; ms: number; usage?: Usage };

async function timedGenerate(params: LLMGenerateParams, calls: ModelCall[]) {
  const started = performance.now();
  let usage: Usage | undefined;
  try {
    return await generateWithOpenAI(gateway, fallbackModel, params, (reported) => {
      usage = reported;
    });
  } finally {
    calls.push({
      name: params.responseFormat?.type === "json_schema" ? params.responseFormat.name : "unknown",
      ms: Math.round(performance.now() - started),
      usage,
    });
  }
}

function write(name: string, row: object) {
  const line = JSON.stringify(row) + "\n";
  appendFileSync(join(dir!, name + ".jsonl"), line);
}

async function replay(
  { task, snapshot, schema }: (typeof tasks)[number],
  arm: (typeof arms)[number],
  round: number,
) {
  const cascade = arm.startsWith("decider");
  const calls: ModelCall[] = [];
  const decisions: { inputTokens: number; outputTokens: number }[] = [];
  let accepted = false;
  const logger = new StagehandLogger({ tracer }, ({ message }) => {
    if (message === "System One extraction accepted") accepted = true;
  });
  const started = performance.now();
  let data;
  let error;
  try {
    const result = await extract({
      params: {
        pageId: "frozen-page",
        instruction: task.instruction,
        schema,
        options: { cache: false, timeout: 65_000 },
      },
      page: {
        captureSnapshot: async () => ({
          combinedTree: snapshot.tree,
          combinedXpathMap: snapshot.xpathMap,
          combinedUrlMap: snapshot.urlMap,
        }),
        screenshot: async () => new Uint8Array(),
      },
      model: { source: "client" },
      clientLLMGenerate: (params) => timedGenerate(params, calls),
      logger,
      decisions: cascade
        ? {
            ...decisionConfig,
            extract: "map",
            recordDecisionUsage: (usage) => decisions.push(usage),
          }
        : undefined,
      compactEvidenceExperiment: arm.endsWith("-compact"),
    });
    data = result.data;
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  write("replay", {
    arm,
    round,
    task: task.name,
    category: task.category,
    passed: !error && task.grade(data),
    data,
    error,
    calls,
    decisions,
    accepted,
    ms: Math.round(performance.now() - started),
  });
}

async function forConcurrent<T>(items: T[], run: (item: T, index: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < items.length) {
        const index = next++;
        await run(items[index]!, index);
      }
    }),
  );
}

for (let round = 0; round < rounds; round++) {
  await forConcurrent(tasks, async (job, index) => {
    const offset = (index + round) % arms.length;
    for (const arm of [...arms.slice(offset), ...arms.slice(0, offset)])
      await replay(job, arm, round);
  });
  process.stdout.write(`Completed replay round ${round + 1}/${rounds}\n`);
}
