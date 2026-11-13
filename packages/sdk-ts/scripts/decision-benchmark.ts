import OpenAI from "openai";
import { z } from "zod/v4";
import { localBrowser, Stagehand, type ExperimentalDecisionsConfig } from "../src/index.js";
import { generateWithOpenAI } from "./openaiStructuredGeneration.js";

const env = process.env;
const gateway = new OpenAI({
  baseURL: "https://ai-gateway.vercel.sh/v1",
  apiKey: env.AI_GATEWAY_API_KEY,
  maxRetries: 0,
});
const baseline = "openai/gpt-6-luna";
const rounds = z.coerce
  .number()
  .int()
  .positive()
  .parse(env.BENCHMARK_ROUNDS ?? 3);
const configs: Record<string, ExperimentalDecisionsConfig | undefined> = {
  baseline: undefined,
  jev: { provider: "typesafe", apiKey: env.TYPESAFE_API_KEY! },
  clef: {
    provider: "cloudflare",
    apiKey: env.CLOUDFLARE_AUTH_TOKEN!,
    accountId: env.CLOUDFLARE_ACCOUNT_ID!,
    model: "clef-flash",
  },
  decider: { provider: "perplexity", apiKey: env.PERPLEXITY_API_KEY! },
  flash: {
    provider: "perplexity",
    apiKey: env.PERPLEXITY_API_KEY!,
    model: "pplx-decider-flash-latest",
  },
};
configs.clairic = { ...configs.clef!, extract: "native" };
configs.locate = { ...configs.decider!, extract: "native" };
configs.locateFlash = { ...configs.flash!, extract: "native" };
configs.judge = { ...configs.jev!, extract: "judge" };

const pricingSchema = z.object({
  basic: z.number().describe("Basic plan price in USD per user per month, billed yearly"),
  business: z.number().describe("Business plan price in USD per user per month, billed yearly"),
});
const scenarios = [
  {
    name: "dropdown",
    operation: "act",
    url: "https://stagehand-eval-sites.vercel.app/sites/dropdown/",
  },
  {
    name: "checkout",
    operation: "act",
    url:
      "data:text/html," +
      encodeURIComponent(
        "<button>Keep shopping</button><button onclick=\"document.querySelector('#status').textContent='checkout'\">Proceed to checkout</button><p id=\"status\">cart</p>",
      ),
  },
  { name: "linear", operation: "extract", url: "https://linear.app/pricing" },
  {
    name: "list",
    operation: "extract",
    url:
      "data:text/html," +
      encodeURIComponent(
        "<h1>Plans</h1><table><tr><th>Plan</th><th>Price</th></tr><tr><td>Basic</td><td>$10</td></tr><tr><td>Business</td><td>$16</td></tr></table>",
      ),
  },
];
for (let round = 0; round < rounds; round++) {
  for (const scenario of scenarios) {
    const arms = Object.entries(configs).filter(
      ([name, config]) =>
        (!config || config.apiKey) &&
        (scenario.operation === "extract" ||
          !["clairic", "locate", "locateFlash", "judge"].includes(name)),
    );
    const offset = round % arms.length;
    for (const [arm, experimentalDecisions] of [...arms.slice(offset), ...arms.slice(0, offset)]) {
      const browser = await localBrowser.launch({ headless: true });
      const decisionUsage: number[][] = [];
      const llmUsage: number[][] = [];
      let started: number | undefined;
      let elapsed: number | undefined;
      let passed = false;
      let error: string | undefined;
      let value: unknown;
      try {
        const stagehand = await Stagehand.create({
          browser,
          ...(experimentalDecisions ? { experimentalDecisions } : {}),
          model: {
            generate: (params) =>
              generateWithOpenAI(gateway, baseline, params, (usage) => {
                llmUsage.push([
                  usage.inputTokens,
                  usage.outputTokens,
                  usage.cachedInputTokens ?? 0,
                ]);
              }),
          },
          logging: {
            level: "info",
            onLog: (event) => {
              if (event.message === "Decision model usage") {
                const data = event.data as { inputTokens: number; outputTokens: number };
                decisionUsage.push([data.inputTokens, data.outputTokens]);
              }
            },
          },
        });
        try {
          const page = await browser.context.newPage();
          await page.goto(scenario.url);
          const client = experimentalDecisions ? stagehand.experimentalDecisions : stagehand;
          if (scenario.name === "dropdown")
            await page.locator("xpath=/html/body/div/div/button").click();
          started = performance.now();
          if (scenario.operation === "act") {
            const action =
              scenario.name === "dropdown"
                ? "type 'test fill' into the input field"
                : "click the checkout button";
            const result = await client.act(action, { page, cache: false, timeout: 30_000 });
            elapsed = performance.now() - started;
            value =
              scenario.name === "dropdown"
                ? await page.locator("xpath=/html/body/div/input").inputValue()
                : await page.locator("#status").textContent();
            passed =
              result.data.success &&
              value === (scenario.name === "dropdown" ? "test fill" : "checkout");
          } else if (scenario.name === "linear") {
            const result = await client.extract(
              "Find the Basic and Business monthly prices in USD per user when billed annually.",
              pricingSchema,
              { page, cache: false, timeout: 30_000 },
            );
            elapsed = performance.now() - started;
            value = result.data;
            passed = result.data.basic === 10 && result.data.business === 16;
          } else {
            const result = await client.extract(
              "Extract all plans and their USD prices in table order.",
              z.object({ plans: z.array(z.object({ plan: z.string(), price: z.number() })) }),
              { page, cache: false, timeout: 30_000 },
            );
            elapsed = performance.now() - started;
            value = result.data;
            passed =
              JSON.stringify(result.data.plans.map(({ plan, price }) => [plan, price])) ===
              JSON.stringify([
                ["Basic", 10],
                ["Business", 16],
              ]);
          }
        } finally {
          await stagehand.close();
        }
      } catch (err) {
        if (started !== undefined) elapsed ??= performance.now() - started;
        error = err instanceof Error ? err.message.slice(0, 1200) : String(err);
      } finally {
        await browser.close();
      }
      console.log(
        JSON.stringify({
          round,
          task: scenario.name,
          arm,
          passed,
          elapsed,
          value,
          error,
          decisionUsage,
          llmUsage,
        }),
      );
    }
  }
}
