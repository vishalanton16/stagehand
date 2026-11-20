import { trace } from "@opentelemetry/api";
import OpenAI from "openai";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { StagehandLogger } from "../../../extension/logger.js";
import { extract } from "../../../extension/services/extractService.js";

const [vendorArgument, outputArgument, ...decisionRuns] = process.argv.slice(2);
const apiKey = process.env.AI_GATEWAY_API_KEY;
if (!vendorArgument || !outputArgument || !decisionRuns.length || !apiKey) {
  throw new Error(
    "Usage with AI_GATEWAY_API_KEY: replayFallback.ts <vendor-repos> <new-output-dir> <decision-run> ...",
  );
}
const vendor = resolve(vendorArgument);
const output = resolve(outputArgument);
const graderDir = join(vendor, "experimental-decisions/packages/sdk-ts/scripts/system-one");
const model = "openai/gpt-6-luna";
const client = new OpenAI({
  apiKey,
  baseURL: process.env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1",
  timeout: 50_000,
  maxRetries: 0,
});
const logger = new StagehandLogger(
  { tracer: trace.getTracer("system-one-extract-fallback") },
  () => {},
  undefined,
  "off",
);
const systemPrompt =
  "For optional fields, omit the field when the supplied page does not contain the requested fact. Absence is not zero. Return zero only when the page explicitly reports zero for that fact. Do not infer values from outside knowledge.";
type FrozenTask = {
  name: string;
  instruction: string;
  schema: { toJSONSchema(): Parameters<typeof extract>[0]["params"]["schema"] };
  grade(data: unknown): string | undefined;
};
type Manifest = {
  captures: { name: string; sha256: string }[];
  graders: { file: string; sha256: string }[];
};

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const files = new Map<string, string>();
const captures = new Map<string, string>();
const routed = new Set<string>();
function pin(pins: Map<string, string>, name: string, sha: string) {
  if (pins.has(name) && pins.get(name) !== sha) throw new Error(`Inconsistent hash for ${name}`);
  pins.set(name, sha);
}
for (const dir of decisionRuns) {
  const manifest: Manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  for (const { name, sha256 } of manifest.captures) pin(captures, name, sha256);
  for (const { file, sha256 } of manifest.graders) pin(files, file, sha256);
  const lines = readFileSync(join(dir, "results.jsonl"), "utf8").trim().split("\n");
  for (const line of lines) {
    const { task, outcome } = JSON.parse(line);
    if (outcome === "fallback") routed.add(task);
  }
}
const tasks = (
  await Promise.all(
    [...files].map(async ([file, sha]) => {
      const path = join(graderDir, file);
      if (digest(readFileSync(path)) !== sha) throw new Error(`Grader changed: ${file}`);
      return Object.values(await import(pathToFileURL(path).href)).flat() as FrozenTask[];
    }),
  )
).flat();
const cases = [...routed].sort().map((name) => {
  const task = tasks.find((entry) => entry.name === name);
  const bytes = readFileSync(join(vendor, "system-one-corpus", `${name}.json`));
  if (!task || digest(bytes) !== captures.get(name)) throw new Error(`Capture changed: ${name}`);
  return { task, snapshot: JSON.parse(bytes.toString()) };
});
if (cases.length > 24) throw new Error("Luna request budget exceeded");
const adapter = join(graderDir, "../openaiStructuredGeneration.ts");
const { generateWithOpenAI } = await import(pathToFileURL(adapter).href);
mkdirSync(output, { mode: 0o700 });
writeFileSync(
  join(output, "manifest.json"),
  JSON.stringify({
    model,
    decisionRuns,
    adapterSha256: digest(readFileSync(adapter)),
    tasks: [...routed].sort(),
    concurrency: 2,
  }),
);
let next = 0;
async function work() {
  for (let item = cases[next++]; item; item = cases[next++]) {
    const { task, snapshot } = item;
    const started = performance.now();
    let calls = 0;
    try {
      const result = await extract({
        params: {
          pageId: "replay",
          instruction: task.instruction,
          schema: task.schema.toJSONSchema(),
          options: { timeout: 55_000 },
        },
        page: {
          captureSnapshot: async () => ({
            combinedTree: snapshot.tree,
            combinedXpathMap: snapshot.xpathMap,
            combinedUrlMap: snapshot.urlMap,
          }),
          screenshot: async () => {
            throw new Error("This replay has no browser");
          },
        },
        model: { source: "client" },
        clientLLMGenerate: (params) => {
          if (calls++) throw new Error("Expected single-call Luna extraction");
          return generateWithOpenAI(client, model, params);
        },
        logger,
        systemPrompt,
      });
      const pass = task.grade(result.data) === undefined;
      record({ task: task.name, pass, result, calls, ms: Math.round(performance.now() - started) });
    } catch (error) {
      record({
        task: task.name,
        pass: false,
        error: error instanceof Error ? error.name : "Error",
        calls,
        ms: Math.round(performance.now() - started),
      });
    }
  }
}
function record(row: {
  task: string;
  pass: boolean;
  calls: number;
  ms: number;
  result?: unknown;
  error?: string;
}) {
  writeFileSync(join(output, "results.jsonl"), JSON.stringify(row) + "\n", {
    flag: "a",
    mode: 0o600,
  });
  process.stdout.write(
    JSON.stringify({
      task: row.task,
      pass: row.pass,
      calls: row.calls,
      ms: row.ms,
      error: row.error,
    }) + "\n",
  );
}
await Promise.all([work(), work()]);
