import { trace } from "@opentelemetry/api";
import { afterEach, expect, it, vi } from "vitest";
import { StagehandLogger } from "../logger.js";
import { runDecisionsObserve } from "../services/decisions/observe.js";
import type { ElementFacts } from "../services/decisions/actionFacts.js";
import { runWithProgress } from "../understudy/progress.js";

afterEach(() => vi.unstubAllGlobals());

it.each([
  { mutation: "an unresolved in-section link", relevant: true },
  { mutation: "a relabeled link in the next section", relevant: false },
])("revalidates the selected section after $mutation", async ({ relevant }) => {
  const provider = vi.fn();
  vi.stubGlobal("fetch", provider);
  const main = "/html[1]/body[1]/main[1]";
  const outline = [
    "[0-1] RootWebArea: Documentation",
    "  [0-2] main",
    "    [0-3] heading: Further Reading",
    "    [0-4] link: Guide",
    "    [0-5] heading: Other Links",
    "    [0-6] link: Contact",
  ].join("\n");
  const fact = (tag: string, text: string, href?: string): ElementFacts => ({
    tag,
    text,
    href,
    visible: true,
    enabled: true,
    editable: false,
    readonly: false,
    type: "",
    name: "",
    context: "",
  });
  const paths = {
    "0-1": "/",
    "0-2": main,
    "0-3": `${main}/h2[1]`,
    "0-4": `${main}/a[1]`,
    "0-5": `${main}/h2[2]`,
    "0-6": `${main}/a[2]`,
  };
  const facts = {
    "0-3": fact("h2", "Further Reading"),
    "0-4": fact("a", "Guide", "https://docs.test/guide"),
    "0-5": fact("h2", "Other Links"),
    "0-6": fact("a", "Contact", "https://docs.test/contact"),
  };
  const capture = (combinedTree: string, combinedXpathMap: Record<string, string>) => ({
    combinedTree,
    combinedXpathMap,
    combinedUrlMap: {},
  });
  const afterPaths = relevant
    ? {
        "0-1": paths["0-1"],
        "0-2": paths["0-2"],
        "0-3": paths["0-3"],
        "0-4": paths["0-4"],
        "0-7": `${main}/div[1]/a[1]`,
        "0-5": paths["0-5"],
        "0-6": paths["0-6"],
      }
    : paths;
  const afterOutline = relevant ? outline : outline.replace("link: Contact", "link: Support");
  const captureSnapshot = vi
    .fn()
    .mockResolvedValueOnce(capture(outline, paths))
    .mockResolvedValueOnce(capture(afterOutline, afterPaths));
  const result = await runWithProgress({ name: "observe", timeout: 1000 }, (progress) =>
    runDecisionsObserve(
      { apiKey: "test" },
      {
        logger: new StagehandLogger(
          { tracer: trace.getTracer("observe-section-runtime-test") },
          () => {},
        ),
        instruction: "Find all links in the Further Reading section.",
        page: {
          captureSnapshot,
          evaluate: vi.fn(async () => facts) as never,
          url: () => "https://docs.test/",
        },
        snapshotOptions: {},
        progress,
      },
    ),
  );
  expect(result).toMatchObject(
    relevant
      ? { kind: "fallback", reason: "observation_evidence_changed" }
      : { kind: "done", actions: [{ selector: `xpath=${paths["0-4"]}`, method: "click" }] },
  );
  expect(captureSnapshot).toHaveBeenCalledTimes(2);
  expect(provider).not.toHaveBeenCalled();
});
