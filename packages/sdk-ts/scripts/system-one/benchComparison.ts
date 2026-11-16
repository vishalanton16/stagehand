import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import OpenAI from "openai";
import { EvalLogger } from "../../../evals/logger.js";
import { generateWithOpenAI } from "../openaiStructuredGeneration.js";
import { archiveSources } from "./act/archive.js";
import { hash } from "./observe/common.js";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const output = process.argv[2];
if (!output) throw new Error("Expected a new output directory");
for (const key of ["AI_GATEWAY_API_KEY", "PERPLEXITY_API_KEY"])
  if (!process.env[key]) throw new Error(`Missing ${key}`);
const rounds = Number(process.env.BENCH_ROUNDS ?? 3);
const concurrency = Number(process.env.BENCH_CONCURRENCY ?? 3);
if (![rounds, concurrency].every((n) => Number.isInteger(n) && n > 0))
  throw new Error("Rounds and concurrency must be positive integers");
const operations = ["act", "extract", "observe"] as const;
const tasks = operations
  .flatMap((operation) =>
    readdirSync(join(root, "packages/evals/tasks/bench", operation), {
      encoding: "utf8",
      withFileTypes: false,
    })
      .filter((name) => name.endsWith(".ts"))
      .sort((a, b) => a.localeCompare(b))
      .map((name: string) => ({
        operation,
        name: name.slice(0, -3),
        file: `packages/evals/tasks/bench/${operation}/${name}`,
      })),
  )
  .filter(
    (task) =>
      (!process.env.BENCH_OPERATIONS ||
        process.env.BENCH_OPERATIONS.split(",").includes(task.operation)) &&
      (!process.env.BENCH_TASKS || process.env.BENCH_TASKS.split(",").includes(task.name)),
  );
if (!tasks.length) throw new Error("No tasks selected");
if (process.env.BENCH_TASKS)
  for (const name of process.env.BENCH_TASKS.split(","))
    if (!tasks.some((t) => t.name === name)) throw new Error(`Unknown task ${name}`);
mkdirSync(output);
process.env.STAGEHAND_EXTENSION_DIRECTORY_PATH ??= join(root, "packages/extension/dist");
const { Stagehand, localBrowser } = await import("../../src/index.js");
const model = "openai/gpt-6-luna";
const decisionModel = "pplx-decider-v1.3";
const systemPrompt = process.env.BENCH_SYSTEM_PROMPT;
const gateway = new OpenAI({
  baseURL: process.env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1",
  apiKey: process.env.AI_GATEWAY_API_KEY,
  timeout: 40000,
  maxRetries: 0,
});
const cachedHtml = new Map<string, { file: string; html: string }>();
if (process.env.BENCH_CACHED_HTML === "1") {
  for (const task of tasks) {
    const url = readFileSync(join(root, task.file), "utf8").match(/page\.goto\("([^"]+)"/)?.[1];
    if (!url || new URL(url).hostname !== "stagehand-eval-sites.vercel.app")
      throw new Error(`No cached fixture URL for ${task.name}`);
    const path = new URL(url).pathname;
    const file = join(
      root,
      "vendor-repos/system-one-corpus/html",
      path.replace(/\W+/g, "_") + ".html",
    );
    cachedHtml.set(path, { file, html: readFileSync(file, "utf8") });
  }
}
const server = cachedHtml.size
  ? createServer((request, response) => {
      const fixture = cachedHtml.get(new URL(request.url ?? "/", "http://fixture").pathname);
      if (!fixture) return void response.writeHead(404).end();
      const original =
        "https://stagehand-eval-sites.vercel.app" +
        new URL(request.url ?? "/", "http://fixture").pathname;
      // Browser links keep their original origin. Snapshot URL mapping may still use localhost.
      const html = fixture.html.replace(
        /<head\b[^>]*>/i,
        (head) => `${head}<base href="${original}">`,
      );
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
    })
  : undefined;
if (server) await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server?.address();
const localOrigin =
  address && typeof address !== "string" ? `http://127.0.0.1:${address.port}` : undefined;
writeFileSync(
  join(output, "manifest.json"),
  JSON.stringify(
    {
      kind: "existing-bench-baseline-vs-decision",
      at: new Date().toISOString(),
      revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      rounds,
      concurrency,
      model,
      decisionModel,
      systemPrompt: systemPrompt ?? null,
      cachedFixtures: [...cachedHtml].map(([path, fixture]) => ({
        path,
        file: fixture.file,
        sha256: hash(fixture.html),
      })),
      cache: false,
      selfHeal: true,
      operationDeadlineMs: 40000,
      taskDeadlineMs: 120000,
      routing:
        "Only the task category uses decisions; helper operations use ordinary Stagehand in both arms.",
      order:
        "Each task/round runs both arms sequentially in fresh browsers; first arm alternates by task index plus round. Task pairs run concurrently.",
      tasks: tasks.map((task) => ({ ...task, sha256: hash(readFileSync(join(root, task.file))) })),
      runnerSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
      extensionSha256: hash(
        readFileSync(join(process.env.STAGEHAND_EXTENSION_DIRECTORY_PATH, "service-worker.js")),
      ),
    },
    null,
    2,
  ),
);
archiveSources(output);
if (cachedHtml.size)
  writeFileSync(join(output, "fixtures.json.gz"), gzipSync(JSON.stringify([...cachedHtml])));
writeFileSync(join(output, "runner.ts"), readFileSync(fileURLToPath(import.meta.url)));
for (const task of tasks) {
  const dir = join(output, "tasks", task.operation);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, task.name + ".ts"), readFileSync(join(root, task.file)));
}

async function run(task: (typeof tasks)[number], arm: "baseline" | "decision", round: number) {
  const started = performance.now();
  const calls: any[] = [];
  const logs: any[] = [];
  const measured: any[] = [];
  let active: any;
  let browser: Awaited<ReturnType<typeof localBrowser.launch>> | undefined;
  let stagehand: Awaited<ReturnType<typeof Stagehand.create>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let result: any;
  let error: string | undefined;
  try {
    browser = await localBrowser.launch({ headless: true });
    stagehand = await Stagehand.create({
      browser,
      cache: false,
      selfHeal: true,
      ...(systemPrompt ? { systemPrompt } : {}),
      model: {
        generate: (params) =>
          generateWithOpenAI(gateway, model, params, (usage) => {
            calls.push(usage);
            active?.llm.push(usage);
          }),
      },
      ...(arm === "decision"
        ? {
            experimentalDecisions: {
              provider: "perplexity" as const,
              apiKey: process.env.PERPLEXITY_API_KEY!,
              model: decisionModel,
            },
          }
        : {}),
      logging: {
        level: "info",
        onLog: (log) => {
          logs.push(log);
          if (log.message === "Decision model usage") active?.decisions.push(log.data);
          if (/fell back to the LLM/.test(log.message)) {
            if (active) active.fallback = true;
            active?.reasons.push(log.data);
          }
        },
      },
    });
    const page = (await browser.context.activePage()) ?? (await browser.context.newPage());
    if (localOrigin) {
      const goto = page.goto.bind(page);
      page.goto = async (url, options) => {
        const response = await goto(
          url.replace("https://stagehand-eval-sites.vercel.app", localOrigin),
          options,
        );
        // SingleFile can omit <head>, so inserting a base tag into its source is insufficient.
        await page.evaluate((original: string) => {
          const base = document.createElement("base");
          base.href = original;
          document.head.prepend(base);
        }, url);
        return response;
      };
    }
    for (const operation of operations) {
      const client =
        arm === "decision" && operation === task.operation
          ? stagehand.experimentalDecisions
          : stagehand;
      const original = client[operation].bind(client) as (...args: any[]) => Promise<any>;
      (stagehand as any)[operation] = async (...args: any[]) => {
        const optionsIndex = operation === "extract" ? 2 : 1;
        args[optionsIndex] = {
          ...args[optionsIndex],
          timeout: Math.min(args[optionsIndex]?.timeout ?? 40000, 40000),
          cache: false,
        };
        const record = {
          operation,
          ms: 0,
          llm: [] as any[],
          decisions: [] as any[],
          fallback: false,
          reasons: [] as any[],
          result: undefined as any,
          error: undefined as string | undefined,
        };
        const previous = active;
        active = record;
        const mark = performance.now();
        try {
          return (record.result = await original(...args));
        } catch (cause) {
          record.error = String(cause);
          throw cause;
        } finally {
          record.ms = performance.now() - mark;
          measured.push(record);
          active = previous;
        }
      };
    }
    const definition = (await import(pathToFileURL(join(root, task.file)).href)).default;
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
        timer = setTimeout(() => reject(new Error("Task exceeded 120000ms")), 120000);
      }),
    ]);
    try {
      writeFileSync(
        join(output, `${task.name}-${arm}-${round}.snapshot.json`),
        JSON.stringify(await page.snapshot()),
      );
    } catch {
      /* Tasks may close their initial page. */
    }
  } catch (cause) {
    error = String(cause);
  } finally {
    clearTimeout(timer);
    await stagehand?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
  const row = {
    task: task.name,
    operation: task.operation,
    arm,
    round,
    passed: !!result?._success && !error,
    ms: performance.now() - started,
    result,
    error,
    measured,
    calls,
    logs,
  };
  appendFileSync(join(output, "results.jsonl"), JSON.stringify(row) + "\n");
  process.stdout.write(
    JSON.stringify({
      task: row.task,
      operation: row.operation,
      arm,
      round,
      passed: row.passed,
      ms: Math.round(row.ms),
      error: error ?? result?.error,
    }) + "\n",
  );
}

const pairs = Array.from({ length: rounds }, (_, round) =>
  tasks.map((task, index) => ({ task, index, round })),
).flat();
let next = 0;
try {
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < pairs.length) {
        const { task, index, round } = pairs[next++]!;
        const arms =
          (index + round) % 2
            ? (["decision", "baseline"] as const)
            : (["baseline", "decision"] as const);
        for (const arm of arms) await run(task, arm, round);
      }
    }),
  );
} finally {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
}
