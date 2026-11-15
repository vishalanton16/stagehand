import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { generateWithOpenAI } from "../openaiStructuredGeneration.js";
import { archiveSources } from "./act/archive.js";

process.env.STAGEHAND_EXTENSION_DIRECTORY_PATH ??= fileURLToPath(
  new URL("../../../extension/dist/", import.meta.url),
);
const { localBrowser, Stagehand } = await import("../../src/index.js");
const output = process.argv[2];
if (!output) throw new Error("Expected a new operation-coverage directory");
mkdirSync(output);
const cases = [
  {
    name: "hover",
    instruction: "Hover over the Reveal details button without clicking it.",
    method: "hover",
    html: `<button onmouseenter="document.querySelector('#result').textContent='hovered'">Reveal details</button>`,
    expected: "hovered",
  },
  {
    name: "double-click",
    instruction: "Double-click the Open record button.",
    method: "doubleClick",
    html: `<button ondblclick="document.querySelector('#result').textContent='opened'">Open record</button>`,
    expected: "opened",
  },
  {
    name: "drag",
    instruction: "Drag the Source card onto the Drop zone.",
    method: "dragAndDrop",
    html: `<div role="button" aria-label="Source card" draggable="true" ondragstart="event.dataTransfer.setData('text/plain','card')">Source card</div><div role="button" aria-label="Drop zone" ondragover="event.preventDefault()" ondrop="event.preventDefault();document.querySelector('#result').textContent='moved'">Drop zone</div>`,
    expected: "moved",
  },
];
writeFileSync(
  join(output, "manifest.json"),
  JSON.stringify(
    {
      kind: "controlled-operation-fallback",
      cases,
      model: "pplx-decider-v1.3",
      fallbackModel: "openai/gpt-6-luna",
    },
    null,
    2,
  ),
);
archiveSources(output);
const gateway = new OpenAI({
  baseURL: process.env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1",
  apiKey: process.env.AI_GATEWAY_API_KEY,
  timeout: 40_000,
  maxRetries: 0,
});
const browser = await localBrowser.launch({ headless: true });
let fallback = false;
const stagehand = await Stagehand.create({
  browser,
  model: { generate: (params) => generateWithOpenAI(gateway, "openai/gpt-6-luna", params) },
  experimentalDecisions: { apiKey: process.env.PERPLEXITY_API_KEY! },
  logging: {
    level: "info",
    onLog: (log) => {
      if (log.message === "Decisions act fell back to the LLM pipeline") fallback = true;
    },
  },
});
try {
  for (const task of cases) {
    const page = await browser.context.newPage();
    fallback = false;
    try {
      await page.goto(
        "data:text/html," +
          encodeURIComponent(
            "<style>body{padding:80px}button,div[role=button]{width:200px;height:70px;margin:20px;background:#eee}</style>" +
              task.html +
              '<p id="result">unchanged</p>',
          ),
      );
      const valid = await page.evaluate((name) => {
        const element = document.querySelector("button,div[role=button]") as HTMLElement;
        return (
          typeof (name === "hover"
            ? element.onmouseenter
            : name === "double-click"
              ? element.ondblclick
              : element.ondragstart) === "function"
        );
      }, task.name);
      if (!valid) throw new Error(`Invalid ${task.name} fixture before inference`);
      writeFileSync(
        join(output, task.name + ".snapshot.json"),
        JSON.stringify(await page.snapshot()),
      );
      const result = await stagehand.experimentalDecisions.act(task.instruction, {
        page,
        cache: false,
        timeout: 40_000,
      });
      const value = await page.locator("#result").textContent();
      const passed =
        result.data.success &&
        fallback &&
        result.data.actions.some((action) => action.method === task.method) &&
        value === task.expected;
      appendFileSync(
        join(output, "results.jsonl"),
        JSON.stringify({ task: task.name, passed, fallback, value, result }) + "\n",
      );
      process.stdout.write(JSON.stringify({ task: task.name, passed, fallback, value }) + "\n");
    } finally {
      await page.close();
    }
  }
} finally {
  await stagehand.close();
  await browser.close();
}
