import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import OpenAI from "openai";
import { generateWithOpenAI } from "../../openaiStructuredGeneration.js";
import { archive, hash, root, type ObserveLabel } from "./common.js";
import { todoItems } from "./tasks.js";
import { waitForBenchmarkReady } from "./setup.js";

const [source, dir] = process.argv.slice(2);
if (!source || !dir) throw new Error("Expected frozen capture and new live-result directories");
mkdirSync(dir);
const arms = (process.env.OBSERVE_ARMS ?? "runtime,legacy,luna").split(",");
const rounds = Number(process.env.OBSERVE_ROUNDS ?? 2);
const provider = process.env.OBSERVE_PROVIDER ?? "perplexity";
const decisionModel = process.env.OBSERVE_MODEL ?? "pplx-decider-v1.3";
const gateway = new OpenAI({
  baseURL: process.env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1",
  apiKey: process.env.AI_GATEWAY_API_KEY,
  maxRetries: 0,
  timeout: 45000,
});
const currentDir = join(root, "packages/extension/dist");
const baseline = join(root, "vendor-repos/system-one-corpus/runs/cleanup/2026-11-15/baseline");
process.env.STAGEHAND_EXTENSION_DIRECTORY_PATH = currentDir;
const current = await import("../../../src/index.js");
process.env.STAGEHAND_EXTENSION_DIRECTORY_PATH = join(baseline, "packages/extension/dist");
const historical = arms.includes("legacy")
  ? await import(pathToFileURL(join(baseline, "packages/sdk-ts/src/index.ts")).href)
  : current;
process.env.STAGEHAND_EXTENSION_DIRECTORY_PATH = currentDir;
const allTasks: ObserveLabel[] = readdirSync(source)
  .filter((f) => f.endsWith(".labels.json"))
  .flatMap((file) => JSON.parse(readFileSync(join(source, file), "utf8")));
const tasks = allTasks.filter(
  (t) =>
    t.available &&
    (!process.env.OBSERVE_TASKS || process.env.OBSERVE_TASKS.split(",").includes(t.name)),
);
archive(dir, {
  kind: "observe-public-sdk-live",
  source,
  captureManifestHash: hash(readFileSync(join(source, "manifest.json"))),
  arms,
  rounds,
  provider,
  decisionModel,
  llmModel: "openai/gpt-6-luna",
  cache: false,
  viewport: [1440, 1000],
  bundleHash: hash(readFileSync(join(currentDir, "service-worker.js"))),
  baselineBundleHash: arms.includes("legacy")
    ? hash(readFileSync(join(baseline, "packages/extension/dist/service-worker.js")))
    : null,
  tasks: tasks.map((t) => t.name),
  clock:
    "navigation/setup excluded; SDK observation includes snapshots, evidence checks and fallback",
  rawProviderResponses:
    "Frozen replay archives retain wire responses; live retains SDK results, usage and traces.",
});
type Running = {
  browser: any;
  stagehand: any;
  active: { calls: object[]; decisions: object[]; logs: object[]; fallback: boolean };
};
const running = new Map<string, Running>();
try {
  for (const arm of arms) {
    const sdk = arm === "legacy" ? historical : current;
    const browser = await sdk.localBrowser.launch({ headless: true });
    const state: Running = {
      browser,
      stagehand: undefined,
      active: { calls: [], decisions: [], logs: [], fallback: false },
    };
    state.stagehand = await sdk.Stagehand.create({
      browser,
      model: {
        generate: async (params: any) =>
          generateWithOpenAI(gateway, "openai/gpt-6-luna", params, (usage) =>
            state.active.calls.push(usage),
          ),
      },
      experimentalDecisions: {
        provider,
        model: decisionModel,
        apiKey: (provider === "typesafe"
          ? process.env.TYPESAFE_API_KEY
          : provider === "cloudflare"
            ? process.env.CLOUDFLARE_AUTH_TOKEN
            : process.env.PERPLEXITY_API_KEY)!,
        ...(provider === "cloudflare" ? { accountId: process.env.CLOUDFLARE_ACCOUNT_ID } : {}),
      },
      logging: {
        level: "info",
        onLog: (event: any) => {
          if (event.message === "Decision model usage") state.active.decisions.push(event.data);
          if (event.message === "Decisions observe fell back to the LLM")
            state.active.fallback = true;
          if (event.message.startsWith("Decisions observe")) state.active.logs.push(event);
        },
      },
    });
    running.set(arm, state);
  }
  for (let round = 0; round < rounds; round++)
    for (const [index, task] of tasks.entries()) {
      const offset = (round + index) % arms.length;
      for (const arm of [...arms.slice(offset), ...arms.slice(0, offset)]) {
        const state = running.get(arm)!;
        state.active = { calls: [], decisions: [], logs: [], fallback: false };
        const page = await state.browser.context.newPage();
        let result: any,
          error: string | undefined,
          drift = false,
          ms: number | undefined,
          grading: any,
          execution: any;
        const prefix = `${task.name}-${arm}-${round}`;
        try {
          await page.setViewportSize(1440, 1000);
          await page.goto(task.url, { waitUntil: "load", timeout: 30000 });
          if (task.site === "todo") {
            await page.evaluate(() => localStorage.clear());
            await page.reload();
            for (const item of todoItems) {
              await page.locator(".new-todo").fill(item);
              await page.keyPress("Enter");
            }
          }
          await page.waitForTimeout(300);
          await waitForBenchmarkReady(
            page,
            allTasks.find((t) => t.site === task.site && t.available && t.gold !== null)?.gold,
          );
          const count =
            task.gold === null
              ? 0
              : await page.evaluate(
                  (selector: string) =>
                    [...document.querySelectorAll(selector)].filter((el) => {
                      const r = el.getBoundingClientRect();
                      const s = getComputedStyle(el);
                      return (
                        r.width > 0 &&
                        r.height > 0 &&
                        s.display !== "none" &&
                        s.visibility !== "hidden" &&
                        !el.closest('[hidden],[aria-hidden="true"]')
                      );
                    }).length,
                  task.gold,
                );
          if (count !== task.domCount) {
            drift = true;
            throw new Error(`Task drift: ${count} targets versus frozen ${task.domCount}`);
          }
          const before = await page.snapshot();
          writeFileSync(join(dir, prefix + ".before.json"), JSON.stringify(before));
          const start = performance.now();
          result =
            arm === "luna"
              ? await state.stagehand.observe(task.instruction, {
                  page,
                  cache: false,
                  timeout: 45000,
                })
              : await state.stagehand.experimentalDecisions.observe(task.instruction, {
                  page,
                  cache: false,
                  timeout: 45000,
                });
          ms = performance.now() - start;
          grading = await page.evaluate(
            ({ gold, allowed, actions }: any) => {
              const helpers = {
                visible(this: void, e: Element) {
                  const r = e.getBoundingClientRect();
                  const s = getComputedStyle(e);
                  return (
                    r.width > 0 &&
                    r.height > 0 &&
                    s.display !== "none" &&
                    s.visibility !== "hidden" &&
                    !e.closest('[hidden],[aria-hidden="true"]')
                  );
                },
                describe(this: void, e: Element | null) {
                  return e ? e.outerHTML.slice(0, 180) : "unresolved";
                },
              };
              const required: Element[] = gold
                ? [...document.querySelectorAll(gold)].filter(helpers.visible)
                : [];
              const permitted = allowed
                ? [...document.querySelectorAll(allowed)].filter(helpers.visible)
                : required;
              const selected: (Element | null)[] = actions.map((a: any) => {
                try {
                  const n = document.evaluate(
                    a.selector.replace(/^xpath=/, ""),
                    document,
                    null,
                    XPathResult.FIRST_ORDERED_NODE_TYPE,
                    null,
                  ).singleNodeValue;
                  const e = n instanceof Element ? n : n?.parentElement;
                  return e instanceof HTMLImageElement ? (e.closest("a") ?? e) : (e ?? null);
                } catch {
                  return null;
                }
              });
              const missing = required.filter((e) => !selected.includes(e));
              const extra = selected.filter((e) => !e || !permitted.includes(e));
              return {
                missing: missing.map(helpers.describe),
                extra: extra.map(helpers.describe),
                duplicateCount: selected.length - new Set(selected).size,
              };
            },
            {
              gold: task.gold,
              ...(task.allowed ? { allowed: task.allowed } : {}),
              actions: result.data,
            },
          );
          const badActions = result.data.filter(
            (a: any) =>
              (task.methods && !task.methods.includes(a.method)) ||
              (task.arguments && JSON.stringify(task.arguments) !== JSON.stringify(a.arguments)),
          );
          grading = {
            ...grading,
            badActions,
            passed:
              !grading.missing.length &&
              !grading.extra.length &&
              !grading.duplicateCount &&
              !badActions.length,
          };
          if (grading.passed && task.arguments && result.data.length === 1) {
            const began = performance.now();
            const acted = await state.stagehand.act(result.data[0], {
              page,
              cache: false,
              timeout: 15000,
            });
            const actual = await page.locator(task.gold!).inputValue();
            execution = {
              passed: acted.data.success && actual === task.arguments[0],
              ms: performance.now() - began,
              actual,
            };
          }
        } catch (e) {
          error = String(e);
        } finally {
          await page.close();
        }
        const row = {
          task: task.name,
          workload: task.workload,
          arm,
          round,
          passed: !error && grading?.passed && (!execution || execution.passed),
          wrongAccept: arm !== "luna" && !state.active.fallback && !error && !grading?.passed,
          accepted: arm !== "luna" && !state.active.fallback && !error,
          fallback: state.active.fallback,
          drift,
          error,
          ms,
          grading,
          execution,
          result,
          decisions: state.active.decisions,
          llm: state.active.calls,
          logs: state.active.logs,
        };
        appendFileSync(join(dir, "results.jsonl"), JSON.stringify(row) + "\n");
        process.stdout.write(
          JSON.stringify({
            task: task.name,
            arm,
            round,
            passed: row.passed,
            wrongAccept: row.wrongAccept,
            fallback: row.fallback,
            error,
            ms: ms && Math.round(ms),
            execution,
          }) + "\n",
        );
      }
    }
} finally {
  for (const state of running.values()) {
    await state.stagehand?.close();
    await state.browser.close();
  }
}
