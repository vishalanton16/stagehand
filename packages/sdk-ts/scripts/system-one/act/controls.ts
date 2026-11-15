import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { generateWithOpenAI } from "../../openaiStructuredGeneration.js";
import { archiveSources } from "./archive.js";

process.env.STAGEHAND_EXTENSION_DIRECTORY_PATH ??= fileURLToPath(
  new URL("../../../../extension/dist/", import.meta.url),
);
const { localBrowser, Stagehand } = await import("../../../src/index.js");
const dir = process.argv[2];
if (!dir) throw new Error("Expected a new control-compatibility results directory");
mkdirSync(dir);
const cases = [
  {
    name: "plaintext-editor",
    html: '<h1>Editor</h1><div id="target" aria-label="Message editor" contenteditable="plaintext-only">old text</div>',
    instruction: 'Fill the Message editor with "fresh evidence".',
    expected: "fresh evidence",
    shouldAct: true,
  },
  {
    name: "nested-editor",
    html: '<h1>Editor</h1><div id="target" aria-label="Message editor" contenteditable="true"><p>old text</p></div>',
    instruction: 'Fill the Message editor with "fresh evidence".',
    expected: "fresh evidence",
    shouldAct: true,
  },
  {
    name: "readonly-field",
    html: '<h1>Form</h1><label>Protected field<input id="target" readonly value="protected"></label>',
    instruction: 'Fill Protected field with "replacement".',
    expected: "protected",
    shouldAct: false,
  },
];
writeFileSync(
  join(dir, "manifest.json"),
  JSON.stringify(
    {
      kind: "controlled-dom-compatibility",
      cases,
      decisionModel: process.env.ACT_MODEL ?? "pplx-decider-v1.3",
    },
    null,
    2,
  ),
);
archiveSources(dir);
const gateway = new OpenAI({
  baseURL: process.env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1",
  apiKey: process.env.AI_GATEWAY_API_KEY,
  maxRetries: 0,
  timeout: 40_000,
});
const browser = await localBrowser.launch({ headless: true });
const stagehand = await Stagehand.create({
  browser,
  model: { generate: (params) => generateWithOpenAI(gateway, "openai/gpt-6-luna", params) },
  experimentalDecisions: {
    provider: "perplexity",
    apiKey: process.env.PERPLEXITY_API_KEY!,
    ...(process.env.ACT_MODEL ? { model: process.env.ACT_MODEL } : {}),
  },
  logging: { level: "off" },
});
try {
  for (const task of cases) {
    const page = await browser.context.newPage();
    try {
      await page.goto("data:text/html," + encodeURIComponent(task.html));
      const before = await page.snapshot();
      const result = await stagehand.experimentalDecisions.act(task.instruction, {
        page,
        cache: false,
        timeout: 30_000,
      });
      const value = await page.evaluate(() => {
        const target = document.querySelector("#target")!;
        return target instanceof HTMLInputElement ? target.value : target.textContent;
      });
      const passed =
        value === task.expected &&
        (task.shouldAct ? result.data.success : result.data.actions.length === 0);
      appendFileSync(
        join(dir, "results.jsonl"),
        JSON.stringify({ task: task.name, passed, value, result, before }) + "\n",
      );
      process.stdout.write(JSON.stringify({ task: task.name, passed, value }) + "\n");
    } finally {
      await page.close();
    }
  }
} finally {
  await stagehand.close();
  await browser.close();
}
