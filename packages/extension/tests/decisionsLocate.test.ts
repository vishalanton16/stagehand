import { StagehandExtractParamsSchema } from "@browserbasehq/stagehand-protocol/schemas";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { extractWithDecider } from "../services/decisions/decider.js";
import { runWithProgress } from "../understudy/progress.js";

afterEach(() => vi.unstubAllGlobals());

it.each(["pplx-decider-latest", "pplx-decider-flash-latest"] as const)(
  "converts locate spans and records reported usage for %s",
  async (modelName) => {
    const state = "🙂 Basic costs $10. Oak and Pine.";
    const locate = (...spans: { start: number; end: number; text: string; score: number }[]) => ({
      type: "locate",
      spans,
    });
    const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({
        answers: {
          price: locate({ start: 14, end: 17, text: "$10", score: 0.99 }),
          tags: locate(
            { start: 27, end: 31, text: "Pine", score: 0.95 },
            { start: 19, end: 22, text: "Oak", score: 0.9 },
          ),
          note: locate(),
        },
        usage: { input_tokens: 83, output_tokens: 3 },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const model = { modelName, apiKey: "test-key" };
    const params = StagehandExtractParamsSchema.parse({
      pageId: "page",
      instruction: "Extract the product details",
      schema: z.toJSONSchema(
        z.object({
          price: z.number(),
          tags: z.array(z.string()),
          note: z.string().nullable(),
        }),
      ),
      options: { locator: { selector: "main" } },
    });
    const captureSnapshot = vi.fn(async () => ({
      combinedTree: state,
      combinedXpathMap: {},
      combinedUrlMap: {},
    }));
    const recordUsage = vi.fn();
    const result = await runWithProgress({ name: "extract", timeout: 0 }, (progress) =>
      extractWithDecider({
        params,
        model,
        progress,
        recordUsage,
        systemPrompt: "",
        page: { captureSnapshot },
      }),
    );
    expect(result.data).toEqual({ price: 10, tags: ["Oak", "Pine"], note: null });
    expect(recordUsage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ inputTokens: 83, outputTokens: 3 }),
    );
    expect(captureSnapshot).toHaveBeenCalledWith(
      { focusLocator: { selector: "main" }, ignoreLocators: undefined },
      expect.anything(),
    );
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.perplexity.ai/v1/decisions");
    if (typeof init.body !== "string") throw new Error("Expected a JSON request body");
    expect(JSON.parse(init.body)).toMatchObject({
      model: modelName,
      state,
      questions: {
        price: { type: "locate" },
        tags: { type: "locate" },
        note: { type: "locate" },
      },
    });
  },
);
