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
const cases = [
  {
    name: "linear",
    url: "https://linear.app/pricing",
    instruction: "Find the Basic and Business monthly prices in USD per user when billed annually.",
    schema: z.object({ basic: z.number(), business: z.number() }),
    expected: { basic: 10, business: 16 },
  },
  {
    name: "geniusee",
    url: "https://stagehand-eval-sites.vercel.app/sites/geniusee/",
    instruction: "Extract the scalability comment in the table for Gemini (Google)",
    schema: z.object({ scalability: z.string() }),
    expected: { scalability: "Scalable architecture with API access" },
  },
  {
    name: "repo",
    url: "https://github.com/browserbase/stagehand",
    instruction: "Extract the name of the repository, without the owner.",
    schema: z.object({ name: z.string() }),
    expected: { name: "stagehand" },
  },
];
const browser = await localBrowser.launch({ headless: true });
const stagehand = await Stagehand.create({ browser, logging: { level: "off" } });
try {
  const page = await browser.context.newPage();
  for (const task of cases) {
    await page.goto(task.url, { waitUntil: "domcontentloaded" });
    const { formattedTree, xpathMap, urlMap } = await page.snapshot();
    const nodes = parseOutline(formattedTree);
    const candidates = buildView(nodes, "text");
    const scores = scoreCandidates(nodes, candidates, task.instruction);
    const ranked = candidates
      .filter(({ id }) => (scores.get(id) ?? 0) > 0)
      .toSorted((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
    const states = {
      full: formattedTree,
      focused: focusOutline(
        nodes,
        ranked.slice(0, 16).map(({ id }) => id),
      ),
    };
    for (let round = 0; round < 3; round++) {
      for (const provider of ["clairic", "locate", "locate-flash"]) {
        const variants = Object.entries(states);
        for (const [variant, state] of round % 2 ? variants.toReversed() : variants) {
          const params = StagehandExtractParamsSchema.parse({
            pageId: page.pageId,
            instruction: task.instruction,
            schema: z.toJSONSchema(task.schema),
          });
          let usage: StagehandResultUsage | undefined;
          let result: unknown;
          let error: string | undefined;
          const start = performance.now();
          try {
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
                      model: {
                        apiKey: env.PERPLEXITY_API_KEY!,
                        modelName:
                          provider === "locate"
                            ? "pplx-decider-latest"
                            : "pplx-decider-flash-latest",
                      },
                    });
              },
            );
            result = response.data;
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
