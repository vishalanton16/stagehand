import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import OpenAI from "openai";
import { z } from "zod/v4";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { heldout5Tasks } from "./heldout5.js";
import { confirmationTasks, heldout6Tasks } from "./heldout6.js";
import { liveCoverageTasks } from "./liveCoverageTasks.js";
import { heldout7Tasks } from "./heldout7.js";
import {
  liveTableCellTasks,
  locatePrimaryTasks,
  locateRequiredTasks,
} from "./locatePrimaryTasks.js";
import { generateWithOpenAI } from "../openaiStructuredGeneration.js";

process.env.STAGEHAND_EXTENSION_DIRECTORY_PATH ??= fileURLToPath(
  new URL("../../../extension/dist/", import.meta.url),
);
const { localBrowser, Stagehand } = await import("../../src/index.js");

const cases = [
  {
    name: "nested-departments",
    html: "<h1>Directory</h1><h2>Research</h2><div><h3>Optics</h3><ul><li>Ada</li><li>Bo</li></ul><h3>Robotics</h3><ul><li>Cy</li><li>Dee</li></ul></div><h2>Sales</h2><ul><li>Eli</li><li>Flo</li></ul>",
    instruction: "List every employee in Research, including all its departments, in page order.",
    schema: z.object({ employees: z.array(z.string()) }),
    expected: { employees: ["Ada", "Bo", "Cy", "Dee"] },
  },
  {
    name: "separate-tables",
    html: "<h1>Inventory</h1><table><tr><th>Item</th><th>Quantity</th></tr><tr><td>Lens</td><td>4</td></tr><tr><td>Tripod</td><td>7</td></tr><tr><td>Filter</td><td>2</td></tr></table><table><tr><th>Item</th><th>Quantity</th></tr><tr><td>Cable</td><td>8</td></tr><tr><td>Battery</td><td>9</td></tr><tr><td>Case</td><td>3</td></tr></table>",
    instruction: "Extract all items and quantities from only the first table.",
    schema: z.object({ items: z.array(z.object({ item: z.string(), quantity: z.number() })) }),
    expected: {
      items: [
        { item: "Lens", quantity: 4 },
        { item: "Tripod", quantity: 7 },
        { item: "Filter", quantity: 2 },
      ],
    },
  },
  {
    name: "explicit-zero",
    html: "<h1>Atlas</h1><dl><dt>Open issues</dt><dd>0</dd><dt>Downloads</dt><dd>17</dd></dl>",
    instruction:
      "Extract the project name and its open issue count. Omit the issue count if absent.",
    schema: z.object({ name: z.string(), issues: z.number().optional() }),
    expected: { name: "Atlas", issues: 0 },
  },
  {
    name: "absent-value",
    html: "<h1>Boreal</h1><dl><dt>Downloads</dt><dd>17</dd><dt>License</dt><dd>MIT</dd></dl>",
    instruction:
      "Extract the project name and its open issue count. Omit the issue count if absent.",
    schema: z.object({ name: z.string(), issues: z.number().optional() }),
    expected: { name: "Boreal" },
  },
  {
    name: "nested-schema-fallback",
    html: "<h1>Contact</h1><p>Person: Lin</p><p>City: Oslo</p>",
    instruction: "Extract the contact's name and address city.",
    schema: z.object({
      contact: z.object({ name: z.string(), address: z.object({ city: z.string() }) }),
    }),
    expected: { contact: { name: "Lin", address: { city: "Oslo" } } },
  },
  {
    name: "record-links",
    html: '<h1>Guides</h1><ul><li><a href="https://example.org/install">Installation</a></li><li><a href="https://example.org/config">Configuration</a></li><li><a href="https://example.org/debug">Debugging</a></li></ul>',
    instruction: "Extract every guide title and URL in page order.",
    schema: z.object({ guides: z.array(z.object({ title: z.string(), url: z.url() })) }),
    expected: {
      guides: [
        { title: "Installation", url: "https://example.org/install" },
        { title: "Configuration", url: "https://example.org/config" },
        { title: "Debugging", url: "https://example.org/debug" },
      ],
    },
  },
];

const codeCellControls = [
  {
    name: "code-cell-spaces",
    html: "<h1>Commands</h1><table><tr><th>Command</th></tr><tr><td><code>git <em>status</em></code></td></tr><tr><td><code>npm <em>run</em> lint</code></td></tr><tr><td><code>tools/<em>lint</em></code></td></tr></table>",
    instruction: "List all commands in page order. Copy each command verbatim.",
    schema: z.object({ commands: z.array(z.string()) }),
    expected: { commands: ["git status", "npm run lint", "tools/lint"] },
  },
];

const scalarControls = [
  {
    name: "table-cell-competing-tables",
    html: "<h1>Rates</h1><h2>South division</h2><table><tr><th>Plan</th><th>Monthly fee</th></tr><tr><td>Standard</td><td>19</td></tr></table><h2>North division</h2><table><tr><th>Plan</th><th>Monthly fee</th></tr><tr><td>Standard</td><td>29</td></tr></table>",
    instruction: "Extract the Monthly fee for the Standard plan in the North division's table.",
    schema: z.object({ fee: z.number().describe("Monthly fee of Standard in North division") }),
    expected: { fee: 29 },
  },
  {
    name: "table-cell-empty-required",
    html: "<h1>Directory</h1><table><tr><th>Team</th><th>Support code</th></tr><tr><td>Falcon</td><td>XY</td></tr><tr><td>Orion</td><td></td></tr></table>",
    instruction:
      "Extract the Support code for Orion. Return an empty string when Orion's cell is empty.",
    schema: z.object({ code: z.string().describe("Support code in the Orion row") }),
    expected: { code: "" },
  },
  {
    name: "table-cell-compound-value",
    html: "<h1>Catalog</h1><table><tr><th>Product</th><th>Support codes</th></tr><tr><td>Falcon</td><td>alpha (primary), beta (legacy)</td></tr><tr><td>Orion</td><td>gamma (primary), delta (legacy)</td></tr></table>",
    instruction: "Extract the primary Support code for Falcon. Copy just the lowercase code.",
    schema: z.object({
      code: z
        .string()
        .regex(/^[a-z]+$/)
        .describe("Primary Support codes entry for Falcon"),
    }),
    expected: { code: "alpha" },
  },
  {
    name: "scalar-clipped-source",
    html: `<h1>Release metadata</h1><p>${"Read this release information carefully. ".repeat(18)}Tracking identifier: ORCHID-733.</p>`,
    instruction: "Copy the exact tracking identifier from the release metadata.",
    schema: z.object({ identifier: z.string().regex(/^ORCHID-\d{3}$/) }),
    expected: { identifier: "ORCHID-733" },
  },
  {
    name: "scalar-zero-and-absence",
    html: "<h1>Billing</h1><dl><dt>Monthly platform fee</dt><dd>$0</dd><dt>Premium support</dt><dd>$19</dd></dl>",
    instruction:
      "Extract the monthly platform fee and the annual platform fee only if explicitly printed. Omit a missing fee. Do not calculate it.",
    schema: z.object({ monthly: z.number(), annual: z.number().optional() }),
    expected: { monthly: 0 },
  },
  {
    name: "scalar-normalized-date",
    html: "<h1>Release notice</h1><p>Released on January 24, 2024.</p><p>Support ends January 24, 2026.</p>",
    instruction: "Return the release date in YYYY-MM-DD format.",
    schema: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    expected: { date: "2024-01-24" },
  },
];

const selectedTasks = process.env.LIVE_TASKS?.split(",").map((name) => {
  const task = [
    ...cases,
    ...codeCellControls,
    ...scalarControls,
    ...locatePrimaryTasks,
    ...locateRequiredTasks,
    ...liveTableCellTasks,
    ...heldout5Tasks,
    ...heldout6Tasks,
    ...heldout7Tasks,
    ...confirmationTasks,
    ...liveCoverageTasks,
  ].find((candidate) => candidate.name === name);
  if (!task) throw new Error(`Unknown live task ${name}`);
  return task;
});

const server = createServer((request, response) => {
  const task = [...cases, ...codeCellControls, ...scalarControls].find(
    (candidate) => request.url === "/" + candidate.name,
  );
  if (!task) return void response.writeHead(404).end();
  response
    .writeHead(200, { "Content-Type": "text/html" })
    .end("<!doctype html><html><body>" + task.html + "</body></html>");
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("No server address");
const gateway = new OpenAI({
  baseURL: process.env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1",
  apiKey: process.env.AI_GATEWAY_API_KEY,
  timeout: 45_000,
  maxRetries: 0,
});
const sourceHash = createHash("sha256")
  .update(readFileSync(new URL(import.meta.url)))
  .digest("hex");
const extensionHash = createHash("sha256")
  .update(
    readFileSync(resolve(process.env.STAGEHAND_EXTENSION_DIRECTORY_PATH, "service-worker.js")),
  )
  .digest("hex");
const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
let failures = 0;
const browser = await localBrowser.launch({ headless: true });
const arms = (process.env.LIVE_ARMS ?? "decider,luna").split(",");
const rounds = Number(process.env.LIVE_ROUNDS ?? 2);
const firstRound = Number(process.env.LIVE_FIRST_ROUND ?? 0);
const fallbackModel = process.env.AI_GATEWAY_MODEL ?? "openai/gpt-6-luna";
try {
  for (let round = firstRound; round < firstRound + rounds; round++) {
    const offset = round % arms.length;
    for (const arm of [...arms.slice(offset), ...arms.slice(0, offset)]) {
      const logs: unknown[] = [];
      const llmUsage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number }[] =
        [];
      const decisionModel = arm === "flash" ? "pplx-decider-flash-v1.3" : "pplx-decider-v1.3";
      const stagehand = await Stagehand.create({
        browser,
        model: {
          generate: (params) =>
            generateWithOpenAI(gateway, fallbackModel, params, (usage) => llmUsage.push(usage)),
        },
        experimentalDecisions: {
          provider: "perplexity",
          apiKey: process.env.PERPLEXITY_API_KEY!,
          model: decisionModel,
          extract: "map",
        },
        logging: {
          level: "debug",
          onLog: (event) => {
            if (event.data.category === "decisions" || event.data.category === "decisions-usage")
              logs.push(event);
          },
        },
      });
      try {
        const page = await browser.context.newPage();
        for (const task of selectedTasks ?? cases) {
          const url = "url" in task ? task.url : `http://127.0.0.1:${address.port}/${task.name}`;
          logs.length = 0;
          llmUsage.length = 0;
          const started = performance.now();
          let result;
          let error;
          let navigationMs: number | undefined;
          try {
            await page.goto(url, { waitUntil: "load", timeout: 30_000 });
            navigationMs = Math.round(performance.now() - started);
            result = await (arm === "luna" ? stagehand : stagehand.experimentalDecisions).extract(
              task.instruction,
              task.schema,
              { page, cache: false, timeout: 60_000 },
            );
          } catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause);
          }
          const failure =
            error ??
            ("grade" in task
              ? task.grade(result?.data ?? {})
              : isDeepStrictEqual(result?.data, task.expected)
                ? undefined
                : "fixture mismatch");
          const passed = failure === undefined;
          if (!passed) failures++;
          process.stdout.write(
            JSON.stringify({
              revision,
              sourceHash,
              extensionHash,
              arm,
              fallbackModel,
              decisionModel: arm === "luna" ? undefined : decisionModel,
              llmUsage,
              round,
              task: task.name,
              passed,
              url: "url" in task ? url : undefined,
              failure,
              navigationMs,
              extractionMs:
                navigationMs === undefined
                  ? undefined
                  : Math.round(performance.now() - started) - navigationMs,
              ms: Math.round(performance.now() - started),
              data: result?.data,
              usage: result?.metadata.usage,
              error,
              logs,
            }) + "\n",
          );
        }
        await page.close();
      } finally {
        await stagehand.close();
      }
    }
  }
} finally {
  await browser.close();
  server.close();
}
if (failures) process.exitCode = 1;
