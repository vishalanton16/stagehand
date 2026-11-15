import { mkdirSync, appendFileSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import OpenAI from "openai";
import { generateWithOpenAI } from "../../openaiStructuredGeneration.js";
import { archive, hash, root } from "./common.js";
const dir = process.argv[2];
if (!dir) throw new Error("Expected new mutation output directory");
mkdirSync(dir);
const dist = join(root, "packages/extension/dist");
const baseline = join(root, "vendor-repos/system-one-corpus/runs/cleanup/2026-11-15/baseline");
process.env.STAGEHAND_EXTENSION_DIRECTORY_PATH = dist;
const current = await import("../../../src/index.js");
process.env.STAGEHAND_EXTENSION_DIRECTORY_PATH = join(baseline, "packages/extension/dist");
const historical = await import(pathToFileURL(join(baseline, "packages/sdk-ts/src/index.ts")).href);
process.env.STAGEHAND_EXTENSION_DIRECTORY_PATH = dist;
const gateway = new OpenAI({
  baseURL: process.env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1",
  apiKey: process.env.AI_GATEWAY_API_KEY,
  timeout: 45000,
  maxRetries: 0,
});
archive(dir, {
  kind: "controlled-observe-mutations",
  rounds: 2,
  delay: 200,
  arms: ["runtime", "legacy", "luna"],
  cases: ["replace", "relabel", "add_member"],
  model: "pplx-decider-v1.3",
  llmModel: "openai/gpt-6-luna",
  bundleHash: hash(readFileSync(join(dist, "service-worker.js"))),
  expected:
    "Never return a stale Delete records target; include a new matching field before returning an all-fields result",
});
for (const arm of ["runtime", "legacy", "luna"]) {
  const sdk = arm === "legacy" ? historical : current;
  const browser = await sdk.localBrowser.launch({ headless: true });
  const logs: object[] = [];
  const stagehand = await sdk.Stagehand.create({
    browser,
    model: { generate: (p: any) => generateWithOpenAI(gateway, "openai/gpt-6-luna", p) },
    experimentalDecisions: {
      provider: "perplexity",
      apiKey: process.env.PERPLEXITY_API_KEY!,
      model: "pplx-decider-v1.3",
    },
    logging: {
      level: "info",
      onLog: (event: any) => {
        if (event.message.startsWith("Decisions observe")) logs.push(event);
      },
    },
  });
  try {
    for (let round = 0; round < 2; round++)
      for (const mutation of ["replace", "relabel", "add_member"]) {
        logs.length = 0;
        const page = await browser.context.newPage();
        try {
          await page.goto(
            "data:text/html," +
              encodeURIComponent(
                '<html><h1>Report console</h1><button id="target" onclick="document.querySelector(\'#result\').textContent=\'reports\'">Open reports</button><label>First name<input id="first"></label><p id="result">unchanged</p></html>',
              ),
          );
          const before = await page.snapshot();
          await page.evaluate((mutation: string) => {
            setTimeout(() => {
              if (mutation === "add_member") {
                document.body.insertAdjacentHTML(
                  "beforeend",
                  '<label>Last name<input id="last"></label>',
                );
              } else {
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
              }
              (window as any).__mutationAt = performance.now();
            }, 200);
          }, mutation);
          const instruction =
            mutation === "add_member"
              ? "Find all the name fields."
              : "Find the Open reports button.";
          const result = await (
            arm === "luna" ? stagehand : stagehand.experimentalDecisions
          ).observe(instruction, { page, cache: false, timeout: 45000 });
          const state = await page.evaluate(
            (actions: any[]) => ({
              mutatedAt: (window as any).__mutationAt,
              returnedAt: performance.now(),
              matches: actions.map((a) => {
                try {
                  const n = document.evaluate(
                    a.selector.replace(/^xpath=/, ""),
                    document,
                    null,
                    XPathResult.FIRST_ORDERED_NODE_TYPE,
                    null,
                  ).singleNodeValue;
                  return n instanceof Element ? { id: n.id, text: n.textContent } : null;
                } catch {
                  return null;
                }
              }),
            }),
            result.data,
          );
          let effect = "unchanged";
          if (mutation !== "add_member" && result.data.length) {
            await stagehand.act(result.data[0], { page, cache: false });
            effect = await page.locator("#result").innerText();
          }
          const passed =
            mutation === "add_member"
              ? state.matches.length === 2 &&
                state.matches.some((x: any) => x?.id === "first") &&
                state.matches.some((x: any) => x?.id === "last")
              : effect !== "WRONG" && !state.matches.some((x: any) => x?.text === "Delete records");
          const row = {
            arm,
            round,
            mutation,
            passed,
            mutationBeforeReturn: state.mutatedAt < state.returnedAt,
            state,
            effect,
            result,
            logs: [...logs],
          };
          appendFileSync(join(dir, "results.jsonl"), JSON.stringify(row) + "\n");
          writeFileSync(
            join(dir, `${mutation}-${arm}-${round}.before.json`),
            JSON.stringify(before),
          );
          process.stdout.write(
            JSON.stringify({
              arm,
              round,
              mutation,
              passed,
              effect,
              mutationBeforeReturn: row.mutationBeforeReturn,
            }) + "\n",
          );
        } finally {
          await page.close();
        }
      }
  } finally {
    await stagehand.close();
    await browser.close();
  }
}
