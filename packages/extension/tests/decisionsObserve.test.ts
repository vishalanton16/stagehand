import { trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StagehandLogger } from "../logger.js";
import { Progress } from "../understudy/progress.js";
import { selectObservation } from "../services/decisions/observeSelection.js";
import { runDecisionsObserve } from "../services/decisions/observe.js";
import type { ObservationSnapshot } from "../services/decisions/observeCandidates.js";
import {
  fakeDecisionProvider,
  type ScriptedAnswer,
  type WireQuestion,
} from "./decisionsTestUtils.js";
import { observe } from "../services/observeService.js";
import { ObserveResultSchema } from "@browserbasehq/stagehand-protocol/schemas";

afterEach(() => vi.unstubAllGlobals());
const logger = () =>
  new StagehandLogger({ tracer: trace.getTracer("observe-decisions-test") }, () => {});
function snapshot(count = 1): ObservationSnapshot {
  const ids = Array.from({ length: count }, (_, i) => `0-${i + 12}`);
  return {
    formattedTree:
      "[0-1] RootWebArea: Contact\n" +
      ids.map((id, i) => `  [${id}] textbox: Field ${i + 1}`).join("\n"),
    xpathMap: Object.fromEntries(ids.map((id, i) => [id, `/html/body/input[${i + 1}]`])),
    urlMap: {},
    editableIds: ids,
    url: "https://contact.test/",
    facts: Object.fromEntries(
      ids.map((id) => [
        id,
        {
          visible: true,
          enabled: true,
          editable: true,
          readonly: false,
          tag: "input",
          type: "text",
          name: "",
          text: "",
          context: "",
        },
      ]),
    ),
  };
}
function serve(
  provider: "typesafe" | "cloudflare" | "perplexity" = "perplexity",
  overrides: (key: string, q: WireQuestion) => ScriptedAnswer | undefined = () => undefined,
) {
  return fakeDecisionProvider(
    provider,
    (key, q) =>
      overrides(key, q) ??
      (key === "cardinality"
        ? { choice: "one", p: 0.99 }
        : key === "operation"
          ? { choice: "default", p: 0.99 }
          : key === "kind"
            ? { choice: "supported", p: 0.99 }
            : key === "target"
              ? { choice: q.options.find((id) => id !== "none_match"), p: 0.99 }
              : { p: 0.99 }),
    (mock) => vi.stubGlobal("fetch", vi.fn(mock)),
  );
}
const config = () => ({
  provider: "perplexity" as const,
  apiKey: `test-${Math.random()}`,
  model: "pplx-decider-v1.3",
});
function page(snap: ObservationSnapshot, after = snap) {
  let captures = 0;
  let current = snap;
  return {
    captureSnapshot: vi.fn(async () => {
      current = captures++ ? after : snap;
      return {
        combinedTree: current.formattedTree,
        combinedXpathMap: current.xpathMap,
        combinedUrlMap: current.urlMap,
        combinedEditableIds: current.editableIds,
      };
    }),
    evaluate: vi.fn(async () => current.facts),
    url: () => snap.url,
  };
}

describe("decision observations", () => {
  it("includes native file controls even when their AX role is not button", async () => {
    const snap = snapshot();
    snap.formattedTree = snap.formattedTree.replace("textbox: Field 1", "input, file: Upload file");
    snap.facts["0-12"]!.type = "file";
    snap.facts["0-12"]!.editable = false;
    serve();
    expect(await selectObservation(config(), snap, "Find the file upload control")).toMatchObject({
      kind: "done",
      actions: [{ selector: "xpath=/html/body/input[1]", method: "click" }],
    });
  });
  it("keeps explicit blank instructions on the ordinary path", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await selectObservation(config(), snapshot(), "  ")).toMatchObject({
      kind: "fallback",
      reason: "empty_instruction",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["typesafe", "cloudflare", "perplexity"] as const)(
    "resolves bounded observations through %s",
    async (provider) => {
      serve(provider);
      expect(
        await selectObservation(
          { ...config(), provider, ...(provider === "cloudflare" ? { accountId: "account" } : {}) },
          snapshot(),
          "Find Field 1",
        ),
      ).toMatchObject({
        kind: "done",
        actions: [{ selector: "xpath=/html/body/input[1]", method: "fill", arguments: [] }],
      });
    },
  );
  it("accounts for every member, including matches beyond position thirty", async () => {
    const seen = serve("perplexity", (key) =>
      key === "cardinality" ? { choice: "all", p: 0.99 } : undefined,
    );
    const result = await selectObservation(config(), snapshot(80), "Find all fields");
    expect(result.kind === "done" && result.actions).toHaveLength(80);
    expect(JSON.stringify(seen)).toContain("match_0-91");
  });
  it("escalates oversized hosted Clef Flash input before it can be truncated", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      await selectObservation(
        { ...config(), provider: "cloudflare", accountId: "account", model: "clef-flash" },
        snapshot(80),
        "Find all fields",
      ),
    ).toMatchObject({ kind: "fallback", reason: "provider_context_budget" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("escalates the whole set if one member is uncertain", async () => {
    serve("perplexity", (key) =>
      key === "cardinality"
        ? { choice: "all", p: 0.99 }
        : key === "match_0-13"
          ? { p: 0.5 }
          : undefined,
    );
    expect(await selectObservation(config(), snapshot(2), "Find all fields")).toMatchObject({
      kind: "fallback",
      reason: "uncertain_set_member",
    });
  });
  it("distinguishes a certified empty choice from a contradictory existence answer", async () => {
    serve("perplexity", (key) =>
      key === "target"
        ? { choice: "none_match", p: 0.99 }
        : key === "exists"
          ? { p: 0.01 }
          : undefined,
    );
    expect(await selectObservation(config(), snapshot(), "Find Country")).toMatchObject({
      kind: "done",
      actions: [],
    });
    serve("perplexity", (key) =>
      key === "target" ? { choice: "none_match", p: 0.99 } : undefined,
    );
    expect(await selectObservation(config(), snapshot(), "Find Country")).toMatchObject({
      kind: "fallback",
    });
  });
  it("redacts previously visible variable values and retains placeholders in fill proposals", async () => {
    const snap = snapshot();
    snap.facts["0-12"]!.context = "Account secret@example.test";
    const seen = serve("perplexity", (key) =>
      key === "operation" ? { choice: "fill", p: 0.99 } : undefined,
    );
    const result = await selectObservation(config(), snap, "Fill Field 1 with %email%", {
      email: "secret@example.test",
    });
    expect(JSON.stringify(seen)).not.toContain("secret@example.test");
    expect(result).toMatchObject({ kind: "done", actions: [{ arguments: ["%email%"] }] });
  });
  it("uses the ordinary path for unbounded arguments and unsupported operations", async () => {
    serve("perplexity", (key) => (key === "operation" ? { choice: "fill", p: 0.99 } : undefined));
    expect(
      await selectObservation(config(), snapshot(), "Type a greeting into Field 1"),
    ).toMatchObject({ kind: "fallback", reason: "unbounded_arguments" });
    serve("perplexity", (key) =>
      key === "operation" ? { choice: "unsupported", p: 0.99 } : undefined,
    );
    expect(await selectObservation(config(), snapshot(), "Drag Field 1")).toMatchObject({
      kind: "fallback",
      reason: "unsupported_observation",
    });
  });
  it("does not silently omit a frame or shadow target without browser evidence", async () => {
    const snap = snapshot();
    delete snap.facts["0-12"];
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await selectObservation(config(), snap, "Find all fields")).toMatchObject({
      kind: "fallback",
      reason: "unrepresented_candidates:1",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("discovers controls without model inference", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const result = await selectObservation(config(), snapshot(3), undefined);
    expect(result.kind === "done" && result.actions).toHaveLength(3);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects replacement at the same XPath before returning an observation", async () => {
    serve();
    const before = snapshot();
    const after = snapshot();
    after.formattedTree = after.formattedTree.replace("0-12", "0-99");
    after.xpathMap = { "0-99": "/html/body/input[1]" };
    after.facts = { "0-99": after.facts["0-12"]! };
    after.editableIds = ["0-99"];
    const result = await runDecisionsObserve(config(), {
      page: page(before, after) as never,
      logger: logger(),
      instruction: "Find Field 1",
      snapshotOptions: {},
      progress: new Progress("observe", 0),
    });
    expect(result).toMatchObject({ kind: "fallback", reason: "observation_evidence_changed" });
  });
  it("invalidates empty results when a new candidate appears", async () => {
    serve("perplexity", (key) =>
      key === "target"
        ? { choice: "none_match", p: 0.99 }
        : key === "exists"
          ? { p: 0.01 }
          : undefined,
    );
    expect(
      await runDecisionsObserve(config(), {
        page: page(snapshot(), snapshot(2)) as never,
        logger: logger(),
        instruction: "Find Field 2",
        snapshotOptions: {},
        progress: new Progress("observe", 0),
      }),
    ).toMatchObject({ kind: "fallback", reason: "observation_evidence_changed" });
  });
  it("preserves custom instructions through ordinary observation", async () => {
    const browser = page(snapshot());
    expect(
      await runDecisionsObserve(config(), {
        page: browser as never,
        logger: logger(),
        instruction: "Find Field 1",
        systemPrompt: "Only return explicitly named controls",
        snapshotOptions: {},
        progress: new Progress("observe", 0),
      }),
    ).toMatchObject({ kind: "fallback", reason: "custom_instructions" });
    expect(browser.captureSnapshot).not.toHaveBeenCalled();
  });
  it("includes decision usage on direct service results and preserves scope", async () => {
    serve();
    const browser = page(snapshot());
    const llm = vi.fn();
    const result = await observe({
      params: {
        pageId: "test-page",
        instruction: "Find Field 1",
        options: { locator: { selector: "main" }, cache: false },
      },
      page: browser as never,
      logger: logger(),
      model: undefined,
      clientLLMGenerate: llm,
      decisions: config(),
    });
    expect(result.metadata.usage.inputTokens).toBe(40);
    expect(() => ObserveResultSchema.parse(result)).not.toThrow();
    expect(browser.captureSnapshot).toHaveBeenCalledWith(
      { focusLocator: { selector: "main" }, ignoreLocators: undefined },
      expect.any(Progress),
    );
    expect(llm).not.toHaveBeenCalled();
  });
  it("charges attempted decisions and fallback inference exactly once", async () => {
    serve("perplexity", (key) =>
      key === "operation" ? { choice: "unsupported", p: 0.99 } : undefined,
    );
    const clientLLMGenerate = vi.fn(async () => ({
      role: "assistant" as const,
      content: { type: "text" as const, text: "observation" },
      outputFormat: "json_schema" as const,
      structuredContent: {
        elements: [{ elementId: "0-12", description: "Field 1", method: "fill", arguments: [] }],
      },
      usage: {
        inputTokens: 11,
        outputTokens: 4,
        totalTokens: 15,
        reasoningTokens: 2,
        cachedInputTokens: 3,
      },
    }));
    const result = await observe({
      params: { pageId: "test-page", instruction: "Press Enter", options: { cache: false } },
      page: page(snapshot()) as never,
      logger: logger(),
      model: { source: "client" },
      clientLLMGenerate,
      decisions: config(),
    });
    expect(result.metadata.usage).toMatchObject({
      inputTokens: 51,
      outputTokens: 7,
      reasoningTokens: 2,
      cachedInputTokens: 3,
    });
    expect(() => ObserveResultSchema.parse(result)).not.toThrow();
    expect(clientLLMGenerate).toHaveBeenCalledTimes(1);
  });
  it("aborts a pending decision at the shared deadline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_url, init) =>
          new Promise((_resolve, reject) =>
            init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }),
          ),
      ),
    );
    const progress = new Progress("observe", 10);
    try {
      await expect(
        runDecisionsObserve(config(), {
          page: page(snapshot()) as never,
          logger: logger(),
          instruction: "Find Field 1",
          snapshotOptions: {},
          progress,
        }),
      ).rejects.toThrow("timed out");
    } finally {
      progress.dispose();
    }
  });
});
