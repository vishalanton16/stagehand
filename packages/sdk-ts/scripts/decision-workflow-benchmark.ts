import OpenAI from "openai";
import { z } from "zod/v4";
import { localBrowser, Stagehand, type ExperimentalDecisionsConfig } from "../src/index.js";
import { generateWithOpenAI } from "./openaiStructuredGeneration.js";

const gateway = new OpenAI({
  baseURL: "https://ai-gateway.vercel.sh/v1",
  apiKey: process.env.AI_GATEWAY_API_KEY,
  maxRetries: 0,
  timeout: 30_000,
});
const arms: [string, ExperimentalDecisionsConfig?][] = [
  ["luna"],
  [
    "flash",
    {
      provider: "perplexity",
      apiKey: process.env.PERPLEXITY_API_KEY!,
      model: "pplx-decider-flash-latest",
    },
  ],
];
const schema = z.object({
  price13: z.number().describe("Starting USD price of the 13-inch MacBook Air"),
  price15: z.number().describe("Starting USD price of the 15-inch MacBook Air"),
});
for (let round = 0; round < 3; round++) {
  for (const [arm, experimentalDecisions] of round % 2 ? arms.toReversed() : arms) {
    const browser = await localBrowser.launch({ headless: true });
    const llm: number[][] = [];
    const decisions: number[][] = [];
    let failure: string | undefined;
    let data: unknown;
    let expected: unknown;
    let passed = false;
    const operations: Record<string, number> = {};
    const destinations: Record<string, string> = {};
    const started = performance.now();
    try {
      const stagehand = await Stagehand.create({
        browser,
        ...(experimentalDecisions ? { experimentalDecisions } : {}),
        model: {
          generate: (params) =>
            generateWithOpenAI(gateway, "openai/gpt-6-luna", params, (u) => {
              llm.push([u.inputTokens, u.outputTokens, u.cachedInputTokens ?? 0]);
            }),
        },
        logging: {
          level: "info",
          onLog: (event) => {
            if (event.message === "Decision model usage")
              decisions.push([Number(event.data.inputTokens), Number(event.data.outputTokens)]);
          },
        },
      });
      try {
        const page = await browser.context.newPage();
        const client = experimentalDecisions ? stagehand.experimentalDecisions : stagehand;
        await page.goto("https://www.apple.com/", { waitUntil: "domcontentloaded" });
        let mark = performance.now();
        const act = await client.act("Click Mac in the main navigation.", {
          page,
          timeout: 30_000,
          cache: false,
        });
        operations.mac = performance.now() - mark;
        destinations.mac = await page.url();
        if (!act.data.success || !new URL(destinations.mac).pathname.startsWith("/mac"))
          throw new Error("Mac navigation failed");
        mark = performance.now();
        const air = await client.act(
          "Open the MacBook Air product page using the MacBook Air link in the product navigation.",
          { page, timeout: 30_000, cache: false },
        );
        operations.air = performance.now() - mark;
        destinations.air = await page.url();
        if (!air.data.success || !new URL(destinations.air).pathname.startsWith("/macbook-air"))
          throw new Error("MacBook Air navigation failed");
        mark = performance.now();
        await page.goto("https://www.apple.com/shop/buy-mac/macbook-air", {
          waitUntil: "domcontentloaded",
        });
        operations.store = performance.now() - mark;
        destinations.store = await page.url();
        // Apple US launch prices for the base M5 models, excluding education discounts.
        // https://www.apple.com/newsroom/2026/03/apple-introduces-the-new-macbook-air-with-m5/
        expected = { price13: 1099, price15: 1299 };
        mark = performance.now();
        const result = await client.extract(
          "Find the starting prices in USD for both the 13-inch and 15-inch MacBook Air on this page.",
          schema,
          { page, timeout: 30_000, cache: false },
        );
        operations.extract = performance.now() - mark;
        data = result.data;
        passed = JSON.stringify(data) === JSON.stringify(expected);
      } finally {
        await stagehand.close();
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    } finally {
      await browser.close();
    }
    process.stdout.write(
      JSON.stringify({
        task: "WebVoyager Apple--0",
        arm,
        round,
        passed,
        operations,
        destinations,
        wallMs: performance.now() - started,
        data,
        expected,
        failure,
        llm,
        decisions,
      }) + "\n",
    );
  }
}
