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
if (!dir) throw new Error("Expected a new mutation results directory");
mkdirSync(dir);
const delay = Number(process.env.ACT_MUTATION_DELAY ?? 850);
writeFileSync(
  join(dir, "manifest.json"),
  JSON.stringify(
    {
      kind: "controlled-mutation-regression",
      delay,
      rounds: 2,
      arms: ["luna", "plans"],
      cases: ["replace", "repurpose"],
      model: "pplx-decider-v1.3",
      llm: "openai/gpt-6-luna",
      expected: "Never activate Delete records after Open reports is removed or repurposed",
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
try {
  for (let round = 0; round < 2; round++)
    for (const mutation of ["replace", "repurpose"] as const) {
      const arms = round % 2 ? ["plans", "luna"] : ["luna", "plans"];
      for (const arm of arms) {
        const logs: object[] = [];
        const stagehand = await Stagehand.create({
          browser,
          model: { generate: (params) => generateWithOpenAI(gateway, "openai/gpt-6-luna", params) },
          experimentalDecisions: {
            provider: "perplexity",
            apiKey: process.env.PERPLEXITY_API_KEY!,
            model: "pplx-decider-v1.3",
          },
          logging: {
            level: "info",
            onLog: (event) => {
              if (event.message.startsWith("Decisions act")) logs.push(event);
            },
          },
        });
        const page = await browser.context.newPage();
        try {
          await page.goto(
            "data:text/html," +
              encodeURIComponent(
                "<html><style>button{width:200px;height:40px}</style><h1>Report console</h1><button id=\"target\" onclick=\"document.querySelector('#result').textContent='reports'\">Open reports</button><button onclick=\"document.querySelector('#result').textContent='settings'\">Open settings</button><p id=\"result\">unchanged</p></html>",
              ),
          );
          const before = await page.snapshot();
          await page.evaluate(
            ({ mutation, delay }) => {
              const state = window as unknown as {
                __mutationAt?: number;
                __clicks: { at: number; text: string }[];
              };
              state.__clicks = [];
              document.addEventListener(
                "click",
                (event) =>
                  state.__clicks.push({
                    at: performance.now(),
                    text: (event.target as Element).textContent ?? "",
                  }),
                true,
              );
              setTimeout(() => {
                const original = document.querySelector("#target") as HTMLButtonElement;
                const target =
                  mutation === "replace"
                    ? (original.cloneNode(true) as HTMLButtonElement)
                    : original;
                target.textContent = "Delete records";
                target.onclick = () => {
                  document.querySelector("#result")!.textContent = "WRONG";
                };
                if (mutation === "replace") original.replaceWith(target);
                state.__mutationAt = performance.now();
              }, delay);
            },
            { mutation, delay },
          );
          const start = performance.now();
          const result = await (arm === "luna" ? stagehand : stagehand.experimentalDecisions).act(
            "Click the Open reports button.",
            { page, cache: false, timeout: 30_000 },
          );
          const ms = performance.now() - start;
          await page.waitForTimeout(1000);
          const after = await page.evaluate(() => {
            const state = window as unknown as {
              __mutationAt?: number;
              __clicks: { at: number; text: string }[];
            };
            return {
              mutationAt: state.__mutationAt,
              clicks: state.__clicks,
              effect: document.querySelector("#result")!.textContent,
            };
          });
          const row = {
            arm,
            mutation,
            round,
            ms,
            passed: after.effect !== "WRONG",
            ...after,
            result,
            logs,
          };
          appendFileSync(join(dir, "results.jsonl"), JSON.stringify(row) + "\n");
          writeFileSync(
            join(dir, `${mutation}-${arm}-${round}.before.json`),
            JSON.stringify(before),
          );
          process.stdout.write(
            JSON.stringify({ arm, mutation, round, passed: row.passed, effect: after.effect }) +
              "\n",
          );
        } finally {
          await page.close();
          await stagehand.close();
        }
      }
    }
} finally {
  await browser.close();
}
