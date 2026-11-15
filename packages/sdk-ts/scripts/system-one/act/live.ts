import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { generateWithOpenAI } from "../../openaiStructuredGeneration.js";
import type { ActTask } from "./tasks.js";
import { readFacts } from "./facts.js";
import { archiveSources } from "./archive.js";

process.env.STAGEHAND_EXTENSION_DIRECTORY_PATH ??= fileURLToPath(
  new URL("../../../../extension/dist/", import.meta.url),
);
const { localBrowser, Stagehand } = await import("../../../src/index.js");
const [captureDir, dir] = process.argv.slice(2);
if (!captureDir || !dir)
  throw new Error("Expected frozen capture directory and new result directory");
mkdirSync(dir);
const arms = (process.env.ACT_ARMS ?? "luna,tree,plans").split(",");
const rounds = Number(process.env.ACT_ROUNDS ?? 2);
const decisionModel = process.env.ACT_MODEL ?? "pplx-decider-v1.3";
const llmModel = process.env.AI_GATEWAY_MODEL ?? "openai/gpt-6-luna";
type Label = ActTask & { available: boolean; goldIds: string[]; eligibleGold: string[] };
const tasks: Label[] = readdirSync(captureDir)
  .filter((file) => file.endsWith(".labels.json"))
  .flatMap((file) => JSON.parse(readFileSync(join(captureDir, file), "utf8")))
  .filter(
    (task: Label) =>
      task.available &&
      (!process.env.ACT_TASKS || process.env.ACT_TASKS.split(",").includes(task.name)),
  );
const hash = (data: string) => createHash("sha256").update(data).digest("hex");
writeFileSync(
  join(dir, "manifest.json"),
  JSON.stringify(
    {
      startedAt: new Date().toISOString(),
      revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      captureDir,
      captureManifestHash: hash(readFileSync(join(captureDir, "manifest.json"), "utf8")),
      arms,
      rounds,
      decisionModel,
      llmModel,
      cache: false,
      viewport: [1440, 1000],
      tasks: tasks.map((task) => task.name),
      scriptHash: hash(readFileSync(new URL(import.meta.url), "utf8")),
    },
    null,
    2,
  ),
);
archiveSources(dir);
const gateway = new OpenAI({
  baseURL: process.env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1",
  apiKey: process.env.AI_GATEWAY_API_KEY,
  timeout: 40_000,
  maxRetries: 0,
});
const browser = await localBrowser.launch({ headless: true });
try {
  for (let round = 0; round < rounds; round++)
    for (const [index, task] of tasks.entries()) {
      const offset = (index + round) % arms.length;
      for (const arm of [...arms.slice(offset), ...arms.slice(0, offset)]) {
        const calls: object[] = [];
        const decisions: object[] = [];
        const logs: object[] = [];
        let fallback = false;
        const stagehand = await Stagehand.create({
          browser,
          model: {
            generate: async (params) => {
              const start = performance.now();
              return generateWithOpenAI(gateway, llmModel, params, (usage) =>
                calls.push({ ms: performance.now() - start, usage }),
              );
            },
          },
          experimentalDecisions: {
            provider: "perplexity",
            apiKey: process.env.PERPLEXITY_API_KEY!,
            model: decisionModel,
            act: arm === "plans" ? "plans" : "tree",
          },
          logging: {
            level: "info",
            onLog: (event) => {
              if (event.message === "Decision model usage") decisions.push(event.data);
              if (event.message === "Decisions act fell back to the LLM pipeline") fallback = true;
              if (event.message.startsWith("Decisions act") || event.message === "act finished")
                logs.push(event);
            },
          },
        });
        const page = await browser.context.newPage();
        const prefix = `${task.name}-${arm}-${round}`;
        let error: string | undefined;
        let result: unknown;
        let before;
        let outcome;
        let ms: number | undefined;
        const started = performance.now();
        try {
          await page.setViewportSize(1440, 1000);
          await page.goto(task.url, { waitUntil: "load", timeout: 30_000 });
          if (task.site === "todo") {
            await page.evaluate(() => localStorage.clear());
            await page.reload();
            for (const text of ["review provider docs", "freeze page snapshot"]) {
              await page.locator(".new-todo").fill(text);
              await page.keyPress("Enter");
            }
          }
          await page.waitForTimeout(500);
          before = await page.snapshot();
          const startingUrl = await page.url();
          const facts = await page.evaluate(readFacts, before.xpathMap);
          const gold =
            task.gold === null
              ? []
              : await page.evaluate(
                  (selector) =>
                    [...document.querySelectorAll(selector)].map((element) => ({
                      visible:
                        element.getBoundingClientRect().width > 0 &&
                        element.getBoundingClientRect().height > 0,
                      text: element.textContent,
                      href: element.getAttribute("href"),
                    })),
                  task.gold,
                );
          if (task.gold !== null && !gold.some((element) => element.visible))
            throw new Error("Task drift: no visible gold target before act");
          await page.evaluate((selector) => {
            const state = window as unknown as { __actEvents: object[] };
            state.__actEvents = [];
            for (const type of ["click", "input", "change"])
              document.addEventListener(
                type,
                (event) => {
                  const element =
                    event.target instanceof Element
                      ? (event.target.closest(
                          'a,button,input,textarea,select,[role="button"],[role="checkbox"]',
                        ) ?? event.target)
                      : null;
                  if (!element) return;
                  const matched = selector
                    ? [...document.querySelectorAll(selector)].some(
                        (target) => target === element || target.contains(element),
                      )
                    : false;
                  state.__actEvents.push({
                    type,
                    gold: matched,
                    tag: element.tagName,
                    text: (element.textContent ?? "").trim().slice(0, 120),
                    label: element.getAttribute("aria-label"),
                    href: element.getAttribute("href"),
                    value: (element as HTMLInputElement).value,
                  });
                },
                { capture: true },
              );
          }, task.gold);
          writeFileSync(
            join(dir, prefix + ".before.json"),
            JSON.stringify({ url: await page.url(), ...before, facts, gold }),
          );
          await page.screenshot({ path: join(dir, prefix + ".before.png") });
          const goldPaths = await page.evaluate(
            ({ selector, paths }) =>
              selector
                ? Object.entries(paths)
                    .filter(([, path]) => {
                      try {
                        const node = document.evaluate(
                          path,
                          document,
                          null,
                          XPathResult.FIRST_ORDERED_NODE_TYPE,
                          null,
                        ).singleNodeValue;
                        return [...document.querySelectorAll(selector)].includes(node as Element);
                      } catch {
                        return false;
                      }
                    })
                    .map(([, path]) => path)
                : [],
            { selector: task.gold, paths: before.xpathMap },
          );
          const mark = performance.now();
          try {
            result = await (arm === "luna" ? stagehand : stagehand.experimentalDecisions).act(
              task.instruction,
              { page, cache: false, timeout: 30_000 },
            );
          } finally {
            ms = performance.now() - mark;
          }
          const verificationStarted = performance.now();
          if (task.postcondition?.enabled !== undefined && task.postcondition.selector) {
            await page.waitForFunction(
              ({ selector, enabled }) => {
                const element = document.querySelector(selector);
                return Boolean(element) && !element!.matches(":disabled") === enabled;
              },
              { selector: task.postcondition.selector, enabled: task.postcondition.enabled },
              { timeout: 6000 },
            );
          } else await page.waitForTimeout(350);
          const finalUrl = await page.url();
          const state = await page.evaluate((selector) => {
            const events =
              (window as unknown as { __actEvents?: { type: string; gold: boolean }[] })
                .__actEvents ?? [];
            const elements = selector ? [...document.querySelectorAll(selector)] : [];
            return {
              events,
              values: elements.map((element) => (element as HTMLInputElement).value),
              checked: elements.map((element) => (element as HTMLInputElement).checked),
              enabled: elements.map((element) => !element.matches(":disabled")),
            };
          }, task.postcondition?.selector ?? task.gold);
          const actionData = (
            result as {
              data?: {
                success?: boolean;
                actions?: { selector: string; method: string; arguments: string[] }[];
              };
            }
          ).data;
          const actions = actionData?.actions ?? [];
          const postcondition = task.postcondition;
          const passed =
            task.gold === null
              ? actions.length === 0 && state.events.length === 0 && finalUrl === startingUrl
              : postcondition?.urlIncludes
                ? finalUrl.includes(postcondition.urlIncludes)
                : postcondition?.value !== undefined
                  ? state.values.includes(postcondition.value)
                  : postcondition?.checked !== undefined
                    ? state.checked.includes(postcondition.checked)
                    : postcondition?.enabled !== undefined
                      ? state.enabled.includes(postcondition.enabled)
                      : false;
          outcome = {
            passed,
            finalUrl,
            ...state,
            actionData,
            verificationMs: performance.now() - verificationStarted,
            nonGoldFirstAction:
              actions.length > 0 &&
              !new Set(goldPaths.map((path) => `xpath=${path}`)).has(actions[0]!.selector),
          };
          await page.screenshot({ path: join(dir, prefix + ".after.png") });
        } catch (cause) {
          error = String(cause);
        } finally {
          const row = {
            task: task.name,
            site: task.site,
            arm,
            round,
            passed: !error && Boolean(outcome?.passed),
            fallback,
            ms,
            totalMs: performance.now() - started,
            error,
            result,
            outcome,
            calls,
            decisions,
            logs,
          };
          appendFileSync(join(dir, "results.jsonl"), JSON.stringify(row) + "\n");
          process.stdout.write(
            JSON.stringify({
              task: task.name,
              arm,
              round,
              passed: row.passed,
              fallback,
              ms: Math.round(ms ?? 0),
              error,
            }) + "\n",
          );
          await page.close();
          await stagehand.close();
        }
      }
    }
} finally {
  await browser.close();
}
