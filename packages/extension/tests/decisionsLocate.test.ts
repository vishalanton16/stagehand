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

it("converts a single numeric source span without guessing among multiple amounts", async () => {
  const state = "Basic: $10 per user/month. Business: $16 per user/month.";
  const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
    Response.json({
      answers: {
        price: {
          type: "locate",
          spans: [
            {
              start: 7,
              end: 54,
              text: "$10 per user/month. Business: $16 per user/month",
              score: 0.99,
            },
            { start: 7, end: 25, text: "$10 per user/month", score: 0.95 },
          ],
        },
      },
      usage: { input_tokens: 70, output_tokens: 1 },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const params = StagehandExtractParamsSchema.parse({
    pageId: "page",
    instruction: "Find the Basic and Business prices",
    schema: z.toJSONSchema(z.object({ price: z.number().describe("the Basic monthly price") })),
  });
  const result = await runWithProgress({ name: "extract", timeout: 0 }, (progress) =>
    extractWithDecider({
      params,
      model: { modelName: "pplx-decider-flash-latest", apiKey: "test-key" },
      progress,
      systemPrompt: "",
      questionStyle: "source",
      page: {
        captureSnapshot: async () => ({
          combinedTree: state,
          combinedXpathMap: {},
          combinedUrlMap: {},
        }),
      },
    }),
  );
  expect(result.data).toEqual({ price: 10 });
  expect(JSON.parse(fetch.mock.calls[0]![1].body as string).questions.price.instructions).toBe(
    "Find the source span for the Basic monthly price.",
  );
});

it.each([
  { span: { start: 7, end: 9, text: "$0" }, error: undefined },
  { span: { start: 8, end: 10, text: "$0" }, error: "invalid_span_offset:price" },
  { span: { start: 7, end: 16, text: "$0 and $1" }, error: "invalid_scalar_span:price" },
  {
    span: { start: 25, end: 41, text: "9007199254740993" },
    error: "invalid_scalar_span:price",
  },
  { span: undefined, error: "missing_required_span:price" },
])("checks bounded scalar provenance and normalization ($error)", async ({ span, error }) => {
  const state = "🙂 Fee: $0 and $1. Large: 9007199254740993";
  const recordUsage = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        answers: {
          price: { type: "locate", spans: span ? [{ ...span, score: 0.99 }] : [] },
          note: { type: "locate", spans: [] },
        },
        usage: { input_tokens: 70, output_tokens: 2 },
      }),
    ),
  );
  const params = StagehandExtractParamsSchema.parse({
    pageId: "page",
    instruction: "Extract the initial fee and an optional note",
    schema: z.toJSONSchema(z.object({ price: z.number(), note: z.string().optional() })),
  });
  const extraction = runWithProgress({ name: "extract", timeout: 0 }, (progress) =>
    extractWithDecider({
      params,
      model: { modelName: "pplx-decider-v1.3", apiKey: "test-key" },
      progress,
      recordUsage,
      systemPrompt: "",
      boundedScalar: true,
      page: {
        captureSnapshot: async () => ({
          combinedTree: state,
          combinedXpathMap: {},
          combinedUrlMap: {},
        }),
      },
    }),
  );
  if (error) await expect(extraction).rejects.toThrow(error);
  else expect((await extraction).data).toEqual({ price: 0 });
  expect(recordUsage).toHaveBeenCalledOnce();
});
