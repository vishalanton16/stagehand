import { afterEach, describe, expect, it, vi } from "vitest";
import * as client from "../services/decisions/client.js";
import { mapCopyExtract } from "../services/decisions/mapCopy.js";

afterEach(() => vi.restoreAllMocks());

describe("System One missing values", () => {
  it("omits absent optional scalars and returns null for absent nullable scalars", async () => {
    vi.spyOn(client, "decide").mockImplementation(async (_config, _state, questions) => ({
      model: "test",
      answers: Object.fromEntries(
        Object.entries(questions).map(([key, question]) => [
          key,
          question.type === "choice"
            ? { type: "choice" as const, choice: "none", probabilities: { none: 1 }, confidence: 1 }
            : { type: "noul" as const, noul: 1 },
        ]),
      ),
      usage: { inputTokens: 1, outputTokens: 1 },
      durationMs: 1,
    }));
    const outcome = await mapCopyExtract(
      { apiKey: "test" },
      {
        instruction: "Extract issue and star counts when present.",
        schema: {
          type: "object",
          properties: { issues: { type: "number" }, stars: { type: ["number", "null"] } },
          required: ["stars"],
        },
        tree: "[0-1] heading: Example",
        urlMap: {},
        verify: true,
      },
    );
    expect(outcome.data).toEqual({ stars: null });
    expect(outcome.verdict?.problems).toEqual([]);
  });

  it("rejects a required unresolved scalar instead of inventing an empty string", async () => {
    await expect(
      mapCopyExtract(
        { apiKey: "test" },
        {
          instruction: "Extract name.",
          schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
          tree: "",
          urlMap: {},
        },
      ),
    ).rejects.toThrow("unresolved:name");
  });
});

describe("System One composite labels", () => {
  it.each([true, false])(
    "lets the model select the name separately from the code (%s)",
    async (stripPrefix) => {
      vi.spyOn(client, "decide").mockImplementation(async (_config, _state, questions) => ({
        model: "test",
        answers: Object.fromEntries(
          Object.entries(questions).map(([key, question]) => {
            if (question.type === "noul")
              return [key, { type: "noul" as const, noul: key.startsWith("is_") ? 1 : 0 }];
            let choice = Object.keys(question.criteria)[0]!;
            if (key === "f_name" && stripPrefix) {
              choice = Object.entries(question.criteria).find(
                ([, label]) =>
                  typeof label === "string" &&
                  label.startsWith("Text after the leading numeric identifier"),
              )![0];
            }
            return [
              key,
              { type: "choice" as const, choice, probabilities: { [choice]: 1 }, confidence: 1 },
            ];
          }),
        ),
        usage: { inputTokens: 1, outputTokens: 1 },
        durationMs: 1,
      }));
      const outcome = await mapCopyExtract(
        { apiKey: "test" },
        {
          instruction: "Extract every code and name.",
          schema: {
            type: "object",
            required: ["items"],
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  required: ["code", "name"],
                  properties: { code: { type: "integer" }, name: { type: "string" } },
                },
              },
            },
          },
          tree: "[0-1] list\n  [0-2] listitem: 101 Bronze\n  [0-3] listitem: 102 Silver\n  [0-4] listitem: 103 Gold",
          urlMap: {},
          verify: true,
          askVerifier: false,
        },
      );
      expect(outcome.data.items).toEqual([
        { code: 101, name: stripPrefix ? "Bronze" : "101 Bronze" },
        { code: 102, name: stripPrefix ? "Silver" : "102 Silver" },
        { code: 103, name: stripPrefix ? "Gold" : "103 Gold" },
      ]);
    },
  );
});

it("omits an optional number when its candidate does not explicitly state the field", async () => {
  vi.spyOn(client, "decide").mockImplementation(async (_config, _state, questions) => ({
    model: "test",
    answers: Object.fromEntries(
      Object.entries(questions).map(([key, question]) => {
        if (question.type === "noul") return [key, { type: "noul", noul: 0 }];
        const choice = key === "record_group" ? "none" : Object.keys(question.criteria)[0]!;
        return [key, { type: "choice", choice, probabilities: { [choice]: 1 }, confidence: 1 }];
      }),
    ),
    usage: { inputTokens: 1, outputTokens: 1 },
    durationMs: 1,
  }));
  const result = await mapCopyExtract(
    { apiKey: "test" },
    {
      instruction: "Extract the product title and its edition if explicitly stated.",
      schema: {
        type: "object",
        required: ["title"],
        properties: { title: { type: "string" }, edition: { type: "number" } },
      },
      tree: "[0-1] heading: Example Product 2.0",
      urlMap: {},
      reader: async () => ({ edition: "2.0" }),
      readerChecks: true,
      verify: true,
      askVerifier: false,
    },
  );
  expect(result.data).toEqual({ title: "Example Product 2.0" });
});
