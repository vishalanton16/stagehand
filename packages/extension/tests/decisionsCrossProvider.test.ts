import { trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StagehandLogger } from "../logger.js";
import { DECISION_PROVIDERS, type DecisionProviderName } from "../services/decisions/client.js";
import { runDecisionsObserve } from "../services/decisions/observe.js";
import type { DecisionsConfig } from "../services/decisions/pipeline.js";
import {
  fakeDecisionProvider,
  type ScriptedAnswer,
  type WireQuestion,
} from "./decisionsTestUtils.js";

const SHOP = [
  "[0-1] RootWebArea: Shop",
  "  [0-3] textbox: Email",
  "  [0-4] textbox: Name",
  "  [0-5] button: Add to cart",
  "  [0-7] button: Checkout",
  "  [0-9] link: Help",
  "  [0-11] paragraph",
  "    [0-12] StaticText: Price:",
  "    [0-13] StaticText: $1,249.50",
].join("\n");
const XPATHS = Object.fromEntries(
  [3, 4, 5, 7, 9, 11, 12, 13].map((n) => [`0-${n}`, `/html/body/*[${n}]`]),
);

function config(provider: DecisionProviderName): DecisionsConfig {
  return {
    provider,
    apiKey: `key-${provider}-${Math.random()}`,
    ...(provider === "cloudflare" ? { accountId: "acct123" } : {}),
  };
}

function logger() {
  return new StagehandLogger(
    { tracer: trace.getTracer("decisions-cross-provider-test") },
    () => {},
  );
}

function serve(
  provider: DecisionProviderName,
  script: (key: string, question: WireQuestion) => ScriptedAnswer | undefined,
) {
  return fakeDecisionProvider(provider, script, (fetchMock) =>
    vi.stubGlobal("fetch", vi.fn(fetchMock)),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe.each(DECISION_PROVIDERS)("decisions observe on %s", (provider) => {
  it("observes every element the model marks relevant", async () => {
    serve(provider, (key, question) => {
      if (key === "family") return { choice: "fill", p: 0.97 };
      if (key === "cardinality") return { choice: "several", p: 0.96 };
      if (question.type === "noul") return { p: key === "0-3" || key === "0-4" ? 0.93 : 0.04 };
      return undefined;
    });
    const outcome = await runDecisionsObserve(config(provider), {
      page: {
        captureSnapshot: vi.fn(async () => ({
          combinedTree: SHOP,
          combinedXpathMap: XPATHS,
          combinedUrlMap: {},
        })),
      } as never,
      logger: logger(),
      instruction: "find all the text fields",
      snapshotOptions: {},
      ensureTimeRemaining: () => {},
    });
    expect(outcome.kind).toBe("done");
    expect(outcome.kind === "done" && outcome.actions.map((action) => action.selector)).toEqual([
      "xpath=/html/body/*[3]",
      "xpath=/html/body/*[4]",
    ]);
  });
});
