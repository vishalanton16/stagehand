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
