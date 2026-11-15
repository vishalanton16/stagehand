import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import OpenAI from "openai";
import { EvalLogger } from "../../../evals/logger.js";
import { generateWithOpenAI } from "../openaiStructuredGeneration.js";
import { archiveSources } from "./act/archive.js";
import { BASELINE_REVISION } from "./baseline.js";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const [arm, output] = process.argv.slice(2);
if (!output || !["baseline", "cleaned", "luna"].includes(arm))
  throw new Error("Expected baseline|cleaned|luna and a new output directory");
mkdirSync(output);
const baseline = resolve(
  repository,
  "vendor-repos/system-one-corpus/runs/cleanup/2026-11-15/baseline",
);
const source = arm === "baseline" ? baseline : repository;
process.env.STAGEHAND_EXTENSION_DIRECTORY_PATH = join(source, "packages/extension/dist");
const sdk = await import(pathToFileURL(join(source, "packages/sdk-ts/src/index.ts")).href);
const directory = join(repository, "packages/evals/tasks/bench/act");
const tasks = readdirSync(directory).filter(
  (name) =>
    name.endsWith(".ts") &&
    (!process.env.CLEANUP_TASKS ||
      process.env.CLEANUP_TASKS.split(",").includes(name.slice(0, -3))),
);
const concurrency = Number(process.env.CLEANUP_CONCURRENCY ?? 3);
const model = process.env.CLEANUP_MODEL ?? "pplx-decider-v1.3";
const gateway = new OpenAI({
  baseURL: process.env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1",
  apiKey: process.env.AI_GATEWAY_API_KEY,
  timeout: 40_000,
  maxRetries: 0,
});
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
writeFileSync(
  join(output, "manifest.json"),
  JSON.stringify(
    {
      kind: "existing-action-suite",
      arm,
      baselineRevision: BASELINE_REVISION,
      model,
      fallbackModel: "openai/gpt-6-luna",
      concurrency,
      taskDeadlineMs: 120_000,
      actionDeadlineMs: 40_000,
      tasks: tasks.map((name) => ({ name, sha256: hash(join(directory, name)) })),
      runnerSha256: hash(fileURLToPath(import.meta.url)),
      extensionSha256: hash(join(source, "packages/extension/dist/service-worker.js")),
    },
    null,
    2,
  ),
);

archiveSources(output);

async function run(name: string) {
  const started = performance.now();
  const calls: object[] = [];
  const operations: object[] = [];
  const logs: object[] = [];
  const browser = await sdk.localBrowser.launch({ headless: true });
  let stagehand;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let result: unknown;
  let error: string | undefined;
  try {
    stagehand = await sdk.Stagehand.create({
      browser,
      selfHeal: true,
      cache: false,
      model: {
        generate: (params) =>
          generateWithOpenAI(gateway, "openai/gpt-6-luna", params, (usage) => calls.push(usage)),
      },
      ...(arm !== "luna"
        ? {
            experimentalDecisions: {
              provider: "perplexity",
              apiKey: process.env.PERPLEXITY_API_KEY!,
              model,
              ...(arm === "baseline" ? { act: "plans", extract: "map" } : {}),
            },
          }
        : {}),
      logging: {
        level: "info",
        onLog: (log) => {
          logs.push(log);
        },
      },
    });
    const page = await browser.context.newPage();
    const client = arm === "luna" ? stagehand : stagehand.experimentalDecisions;
    const act = client.act.bind(client);
    stagehand.act = async (instruction, options) => {
      const mark = performance.now();
      const result = await act(instruction, {
        ...options,
        timeout: Math.min(options?.timeout ?? 40_000, 40_000),
      });
      operations.push({ instruction, ms: performance.now() - mark, result });
      return result;
    };
    // Task verification uses the ordinary extractor in every arm, so action results
    // do not depend on a second experimental policy.
    const extract = stagehand.extract.bind(stagehand);
    stagehand.extract = (instruction, schema, options) =>
      extract(instruction, schema, { ...options, timeout: 40_000 });
    const definition = (await import(pathToFileURL(join(directory, name)).href)).default;
    result = await Promise.race([
      definition.fn({
        stagehand,
        page,
        logger: new EvalLogger(false),
        debugUrl: "",
        sessionUrl: "",
        input: {},
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Task exceeded 120000ms")), 120_000);
      }),
    ]);
    try {
      writeFileSync(
        join(output, name.replace(".ts", ".snapshot.json")),
        JSON.stringify(await page.snapshot()),
      );
    } catch {
      /* A task may close its initial page. */
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    clearTimeout(timer);
    await stagehand?.close().catch(() => {});
    await browser.close();
  }
  const row = {
    arm,
    task: name.slice(0, -3),
    passed: !!(result as { _success?: boolean })?._success && !error,
    ms: performance.now() - started,
    result,
    error,
    operations,
    calls,
    logs,
  };
  appendFileSync(join(output, "results.jsonl"), JSON.stringify(row) + "\n");
  process.stdout.write(
    JSON.stringify({ arm, task: row.task, passed: row.passed, error, ms: Math.round(row.ms) }) +
      "\n",
  );
}
let next = 0;
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (next < tasks.length) await run(tasks[next++]!);
  }),
);
