import { afterEach, describe, expect, it, vi } from "vitest";
import type { ElementFacts } from "../services/decisions/actionFacts.js";
import type { ObservationSnapshot } from "../services/decisions/observeCandidates.js";
import { selectObservation } from "../services/decisions/observeSelection.js";

const instruction = 'Find all links in the "Further Reading" section.';
const main = "/html/body/main";
const section = `${main}/section`;
const config = { provider: "perplexity" as const, apiKey: "test" };

function snapshot(): ObservationSnapshot {
  const rows = [
    [1, "/", "RootWebArea", "Article"],
    [2, main, "main", ""],
    [3, section, "section", ""],
    [4, `${section}/h2[1]`, "heading", "Further Reading"],
    [5, `${section}/h2[1]/a`, "link", "Further Reading"],
    [6, `${section}/nav`, "navigation", ""],
    [7, `${section}/nav/h2`, "heading", "Navigation"],
    [8, `${section}/nav/a`, "link", "Related resources"],
    [9, `${section}/p[1]`, "paragraph", ""],
    [10, `${section}/p[1]/a[1]`, "link", "Hidden"],
    [11, `${section}/p[1]/a[2]`, "link", "Reference"],
    [12, `${section}/h3`, "heading", "Examples"],
    [13, `${section}/p[2]`, "paragraph", ""],
    [14, `${section}/p[2]/a`, "link", "Illustration"],
    [15, `${section}/p[2]/a/img`, "image", "Illustration"],
    [16, `${section}/h2[2]`, "heading", "Next section"],
    [17, `${section}/p[3]`, "paragraph", ""],
    [18, `${section}/p[3]/a`, "link", "Next reference"],
    [19, `${main}/aside`, "complementary", ""],
    [20, `${main}/aside/a`, "link", "Reference"],
  ] as const;
  const xpathMap: ObservationSnapshot["xpathMap"] = {};
  const facts: ObservationSnapshot["facts"] = {};
  const formattedTree = rows
    .map(([num, path, role, name]) => {
      const id = `0-${num}`;
      const level = path === "/" ? 0 : path.split("/").length - 3;
      const tag = path.split("/").at(-1)!.split("[")[0]!;
      xpathMap[id] = path;
      facts[id] = {
        tag,
        name: "",
        text: num === 14 ? "" : name,
        context: "",
        type: "",
        visible: num !== 10,
        enabled: true,
        editable: false,
        readonly: false,
        ...(tag === "a" ? { href: `https://example.test/#${num}` } : {}),
      } satisfies ElementFacts;
      return `${"  ".repeat(level)}[${id}] ${role}${name ? `: ${name}` : ""}`;
    })
    .join("\n");
  return {
    formattedTree,
    xpathMap,
    facts,
    editableIds: [],
    urlMap: {},
    url: "https://example.test",
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("section-scoped decision observations", () => {
  it("returns the heading permalink and visible links up to the next peer heading", async () => {
    const snap = snapshot();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    expect(await selectObservation(config, snap, instruction)).toEqual({
      kind: "done",
      actions: (
        [
          [5, "Further Reading"],
          [11, "Reference"],
          [14, "Illustration"],
        ] as const
      ).map(([id, name]) => ({
        selector: `xpath=${snap.xpathMap[`0-${id}`]}`,
        description: `link: ${name}`,
        method: "click",
        arguments: [],
      })),
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("excludes image-only links for a text-link request", async () => {
    const snap = snapshot();
    const result = await selectObservation(config, snap, instruction.replace("all", "all text"));

    expect(result.kind === "done" && result.actions.map(({ selector }) => selector)).toEqual(
      [5, 11].map((id) => `xpath=${snap.xpathMap[`0-${id}`]}`),
    );
  });

  it.each<{ cause: string; change: (snap: ObservationSnapshot) => void }>([
    {
      cause: "a matching heading in navigation",
      change: (snap) => {
        snap.formattedTree = snap.formattedTree.replace(
          "heading: Navigation",
          "heading: Further Reading",
        );
        snap.facts["0-7"]!.text = "Further Reading";
      },
    },
    {
      cause: "a heading claimed by untrusted outline text",
      change: (snap) => {
        snap.facts["0-4"]!.text = "Unrelated text";
      },
    },
    {
      cause: "a hidden target heading",
      change: (snap) => {
        snap.facts["0-4"]!.visible = false;
      },
    },
    {
      cause: "a heading with unknown level",
      change: (snap) => {
        snap.xpathMap["0-12"] = `${section}/div`;
        snap.facts["0-12"]!.tag = "div";
      },
    },
    {
      cause: "a native anchor missing from the candidate evidence",
      change: (snap) => {
        snap.formattedTree = snap.formattedTree.replace(/^ *\[0-11\].*\n/mu, "");
        delete snap.facts["0-11"];
      },
    },
    {
      cause: "an unresolved candidate outside the section",
      change: (snap) => {
        delete snap.facts["0-20"];
      },
    },
    {
      cause: "a partially attached child frame",
      change: (snap) => {
        snap.xpathMap["1-1"] = "/html/body/iframe/html";
      },
    },
  ])("falls back without inference for $cause", async ({ change }) => {
    const snap = snapshot();
    change(snap);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    expect(await selectObservation(config, snap, instruction)).toMatchObject({ kind: "fallback" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
