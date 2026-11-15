import OpenAI from "openai";
import * as inference from "../../extension/inference.js";
import { generateWithOpenAI } from "./openaiStructuredGeneration.js";
import { collectRecords, rankRecords, renderRecords, oracleRecords } from "./decision-records.js";
import { z } from "zod/v4";
import { StagehandExtractParamsSchema } from "@browserbasehq/stagehand-protocol/schemas";
import type { StagehandResultUsage } from "@browserbasehq/stagehand-protocol/types";
import { extractWithClairic } from "../../extension/services/decisions/clairic.js";
import { extractWithDecider } from "../../extension/services/decisions/decider.js";
import {
  buildView,
  focusOutline,
  parseOutline,
  scoreCandidates,
} from "../../extension/services/decisions/tree.js";
import { runWithProgress } from "../../extension/understudy/progress.js";
import { localBrowser, Stagehand } from "../src/index.js";

const env = process.env;
const gateway = new OpenAI({
  baseURL: "https://ai-gateway.vercel.sh/v1",
  apiKey: env.AI_GATEWAY_API_KEY,
  maxRetries: 0,
  timeout: 30_000,
});
const rounds = z.coerce
  .number()
  .int()
  .positive()
  .parse(env.BENCHMARK_ROUNDS ?? 2);
const cases = [
  {
    name: "linear",
    url: "https://linear.app/pricing",
    instruction: "Find the Basic and Business monthly prices in USD per user when billed annually.",
    schema: z.object({
      basic: z.number().describe("Basic plan monthly USD price per user when billed annually"),
      business: z
        .number()
        .describe("Business plan monthly USD price per user when billed annually"),
    }),
    expected: { basic: 10, business: 16 },
    oracle: [/^\$10 per user/, /^\$16 per user/],
  },
  {
    name: "geniusee",
    url: "https://stagehand-eval-sites.vercel.app/sites/geniusee/",
    instruction: "Extract the scalability comment in the table for Gemini (Google)",
    schema: z.object({ scalability: z.string() }),
    expected: { scalability: "Scalable architecture with API access" },
    oracle: [/^Scalable architecture with API access$/],
  },
  {
    name: "apple",
    url: "https://www.apple.com/newsroom/2026/03/apple-introduces-the-new-macbook-air-with-m5/",
    instruction:
      "Extract the US starting prices for the 13-inch and 15-inch MacBook Air with M5. Exclude education prices.",
    schema: z.object({
      price13: z.number().describe("US retail starting price for the 13-inch M5"),
      price15: z.number().describe("US retail starting price for the 15-inch M5"),
    }),
    expected: { price13: 1099, price15: 1299 },
    oracle: [/13-inch MacBook Air with M5 starts at/],
  },
  {
    name: "repo",
    url: "https://github.com/browserbase/stagehand",
    instruction: "Extract the name of the repository, without the owner.",
    schema: z.object({ name: z.string() }),
    expected: { name: "stagehand" },
    oracle: [/^stagehand$/],
  },
];
const browser = await localBrowser.launch({ headless: true });
const stagehand = await Stagehand.create({ browser, logging: { level: "off" } });
try {
  const page = await browser.context.newPage();
  for (const task of cases) {
    if (env.BENCHMARK_TASK && !env.BENCHMARK_TASK.split(",").includes(task.name)) continue;
    let snapshot;
    try {
      await page.goto(task.url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      snapshot = await page.snapshot();
    } catch (error) {
      process.stdout.write(
        JSON.stringify({
          task: task.name,
          error: error instanceof Error ? error.message : String(error),
        }) + "\n",
      );
      continue;
    }
    const { formattedTree, xpathMap, urlMap } = snapshot;
    const records = collectRecords(formattedTree);
    let oracle: string | undefined;
    try {
      oracle = oracleRecords(formattedTree, task.oracle);
    } catch (error) {
      process.stderr.write(
        `${task.name}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    const nodes = parseOutline(formattedTree);
    const candidates = buildView(nodes, "text");
    const scores = scoreCandidates(nodes, candidates, task.instruction);
    const ranked = candidates
      .filter(({ id }) => (scores.get(id) ?? 0) > 0)
      .toSorted((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
    const states = {
      full: formattedTree,
      ...(oracle ? { oracle } : {}),
      records: renderRecords(rankRecords(records, task.instruction)),
      blocks: renderRecords(rankRecords(collectRecords(formattedTree, true), task.instruction)),
      focused: focusOutline(
        nodes,
        ranked.slice(0, 16).map(({ id }) => id),
      ),
    };
    for (let round = 0; round < rounds; round++) {
      for (const provider of [
        "clairic",
        "locate",
        "locate-flash",
        "locate-source",
        "flash-source",
        "luna",
      ]) {
        if (env.BENCHMARK_PROVIDER && !env.BENCHMARK_PROVIDER.split(",").includes(provider))
          continue;
        const variants = Object.entries(states).filter(
          ([variant]) =>
            !env.BENCHMARK_VARIANT || env.BENCHMARK_VARIANT.split(",").includes(variant),
        );
        for (const [variant, state] of round % 2 ? variants.toReversed() : variants) {
          const params = StagehandExtractParamsSchema.parse({
            pageId: page.pageId,
            instruction: task.instruction,
            schema: z.toJSONSchema(task.schema),
          });
          let usage: StagehandResultUsage | undefined;
          let result: unknown;
          const llmUsage: {
            inputTokens: number;
            outputTokens: number;
            cachedInputTokens: number;
          }[] = [];
          let error: string | undefined;
          const start = performance.now();
          try {
            if (!state.trim()) throw new Error("No evidence for variant");
            if (provider === "luna") {
              const { data } = await inference.extract({
                instruction: task.instruction,
                domElements: state,
                schema: task.schema,
                generate: (input) =>
                  generateWithOpenAI(gateway, "openai/gpt-6-luna", input, (tokens) =>
                    llmUsage.push({ ...tokens, cachedInputTokens: tokens.cachedInputTokens ?? 0 }),
                  ),
              });
              result = data;
            } else {
              const response = await runWithProgress(
                { name: "extract", timeout: 30_000 },
                async (progress) => {
                  const common = {
                    params,
                    systemPrompt: "",
                    progress,
                    recordUsage: (entry: StagehandResultUsage) => {
                      usage = entry;
                    },
                    page: {
                      captureSnapshot: async () => ({
                        combinedTree: state,
                        combinedXpathMap: xpathMap,
                        combinedUrlMap: urlMap,
                      }),
                      screenshot: async () => {
                        throw new Error("Text benchmark");
                      },
                    },
                  };
                  return provider === "clairic"
                    ? extractWithClairic({
                        ...common,
                        model: {
                          apiKey: env.CLOUDFLARE_AUTH_TOKEN!,
                          accountId: env.CLOUDFLARE_ACCOUNT_ID!,
                        },
                      })
                    : extractWithDecider({
                        ...common,
                        questionStyle: provider.endsWith("-source") ? "source" : "exact",
                        model: {
                          apiKey: env.PERPLEXITY_API_KEY!,
                          modelName:
                            provider === "locate" || provider === "locate-source"
                              ? "pplx-decider-latest"
                              : "pplx-decider-flash-latest",
                        },
                      });
                },
              );
              result = response.data;
            }
          } catch (err) {
            error = err instanceof Error ? err.message : String(err);
          }
          const passed = JSON.stringify(result) === JSON.stringify(task.expected);
          process.stdout.write(
            JSON.stringify({
              task: task.name,
              round,
              provider,
              variant,
              passed,
              characters: state.length,
              elapsedMs: performance.now() - start,
              usage,
              llmUsage,
              result,
              error,
            }) + "\n",
          );
        }
      }
    }
  }
} finally {
  await stagehand.close();
  await browser.close();
}
