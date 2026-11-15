import { trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import type { LLMGenerateResult } from "@browserbasehq/stagehand-protocol/types";
import { StagehandLogger } from "../logger.js";
import * as mapping from "../services/decisions/mapCopy.js";
import { extract } from "../services/extractService.js";

afterEach(() => vi.restoreAllMocks());

function setup() {
  const generate = vi.fn(async (_params): Promise<LLMGenerateResult> => ({
    role: "assistant",
    content: { type: "text", text: "result" },
    outputFormat: "json_schema",
    structuredContent: { name: "Example", stars: 0 },
    usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
  }));
  return {
    params: {
      pageId: "test",
      instruction: "Extract the name and stars, if available.",
      schema: z
        .json()
        .parse(z.toJSONSchema(z.object({ name: z.string(), stars: z.number().optional() }))),
      options: { timeout: 1000, cache: false },
    },
    page: {
      captureSnapshot: vi.fn(async () => ({
        combinedTree: "[0-1] heading: Example\n[0-2] text: Stars: 0",
        combinedXpathMap: {},
        combinedUrlMap: {},
      })),
      screenshot: vi.fn(async () => new Uint8Array()),
    },
    decisions: { provider: "typesafe" as const, apiKey: "test", extract: "map" as const },
    model: { source: "client" as const },
    clientLLMGenerate: generate,
    logger: new StagehandLogger({ tracer: trace.getTracer("system-one-test") }, () => {}),
  };
}

describe("System One extract service", () => {
  it("accepts schema-valid mapping, preserves zero and reports decision usage", async () => {
    vi.spyOn(mapping, "mapCopyExtract").mockImplementation(async (config) => {
      config.recordDecisionUsage?.({ inputTokens: 30, outputTokens: 2 });
      return {
        data: { name: "Example", stars: 0 },
        trace: [],
        verdict: { problems: [], agree: 1 },
      };
    });
    const options = setup();
    const result = await extract({ ...options, systemPrompt: "This is policy number 42." });
    expect(mapping.mapCopyExtract).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ instruction: options.params.instruction, askVerifier: false }),
    );
    expect(result.data).toEqual({ name: "Example", stars: 0 });
    expect(result.metadata.usage).toMatchObject({ inputTokens: 30, outputTokens: 2 });
    expect(options.clientLLMGenerate).not.toHaveBeenCalled();
    expect(options.page.captureSnapshot).toHaveBeenCalledTimes(1);
  });

  it("preserves omitted optional fields", async () => {
    vi.spyOn(mapping, "mapCopyExtract").mockResolvedValue({
      data: { name: "Example" },
      trace: [],
      verdict: { problems: [], agree: 1 },
    });
    expect((await extract(setup())).data).toEqual({ name: "Example" });
  });

  it("falls back after structural problems and includes both paths' usage", async () => {
    vi.spyOn(mapping, "mapCopyExtract").mockImplementation(async (config) => {
      config.recordDecisionUsage?.({ inputTokens: 30, outputTokens: 2 });
      return {
        data: { name: "Wrong" },
        trace: [],
        verdict: { problems: ["group-disagree"], agree: 1 },
      };
    });
    const options = setup();
    const result = await extract(options);
    expect(result.data).toEqual({ name: "Example", stars: 0 });
    expect(result.metadata.usage).toMatchObject({ inputTokens: 40, outputTokens: 4 });
    expect(options.clientLLMGenerate).toHaveBeenCalledTimes(1);
    expect(options.clientLLMGenerate.mock.calls[0][0].systemPrompt).toContain(
      "Absence is not zero",
    );
  });

  it("rejects an invalid mapping even when its gate accepts", async () => {
    vi.spyOn(mapping, "mapCopyExtract").mockResolvedValue({
      data: { name: 42 },
      trace: [],
      verdict: { problems: [], agree: 1 },
    });
    const options = setup();
    expect((await extract(options)).data).toEqual({ name: "Example", stars: 0 });
    expect(options.clientLLMGenerate).toHaveBeenCalledTimes(1);
  });

  it("falls back directly to the LLM for a missing selected table cell and keeps its usage", async () => {
    const mapper = vi.spyOn(mapping, "mapCopyExtract");
    const options = setup();
    options.page.captureSnapshot.mockResolvedValue({
      combinedTree: "[0-1] table",
      combinedXpathMap: {},
      combinedUrlMap: {},
    });
    const cell = (text: string, header = false) => ({
      text,
      header,
      scope: header ? "col" : "",
      rowspan: 1,
      colspan: 1,
    });
    const evaluate = vi.fn(async () => [
      {
        heading: "Directory",
        caption: "",
        rows: [
          { section: "THEAD", cells: [cell("Team", true), cell("Name", true)] },
          { section: "TBODY", cells: [cell("Orion"), cell("")] },
        ],
      },
    ]);
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if (typeof init?.body !== "string") throw new TypeError("Expected a JSON request body");
      const { questions } = JSON.parse(init.body);
      const criteria = questions.cell0.criteria as Record<string, string>;
      const choice = Object.keys(criteria).find((key) =>
        criteria[key]!.includes("| column Name | value (empty)"),
      );
      expect(choice).toBeDefined();
      return Response.json({
        answers: {
          cell0: {
            type: "choice",
            choice,
            confidence: 1,
            probabilities: Object.fromEntries(
              Object.keys(criteria).map((key) => [key, key === choice ? 1 : 0]),
            ),
          },
        },
        usage: { input_tokens: 60, output_tokens: 2 },
      });
    });
    const result = await extract({
      ...options,
      params: {
        ...options.params,
        instruction: "Find the Name listed for the Orion team",
        schema: z.json().parse(
          z.toJSONSchema(
            z.object({
              name: z.string().describe("Name of the Orion team"),
            }),
          ),
        ),
      },
      page: { ...options.page, evaluate },
      decisions: { ...options.decisions, provider: "perplexity" },
      tableCellExperiment: true,
      clientLLMGenerate: async (params) => {
        const result = await options.clientLLMGenerate(params);
        return { ...result, structuredContent: { name: "Example" } };
      },
    });
    expect(result.data).toEqual({ name: "Example" });
    expect(result.metadata.usage).toMatchObject({ inputTokens: 70, outputTokens: 4 });
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mapper).not.toHaveBeenCalled();
  });

  it("respects disabled fallback on provider failure", async () => {
    vi.spyOn(mapping, "mapCopyExtract").mockRejectedValue(new Error("provider unavailable"));
    const options = setup();
    await expect(
      extract({ ...options, decisions: { ...options.decisions, llmFallback: false } }),
    ).rejects.toThrow("provider unavailable");
    expect(options.clientLLMGenerate).not.toHaveBeenCalled();
  });

  it("propagates the deadline without starting fallback", async () => {
    vi.spyOn(mapping, "mapCopyExtract").mockImplementation(() => new Promise(() => {}));
    const options = setup();
    await expect(
      extract({ ...options, params: { ...options.params, options: { timeout: 10 } } }),
    ).rejects.toThrow();
    expect(options.clientLLMGenerate).not.toHaveBeenCalled();
  });
});
