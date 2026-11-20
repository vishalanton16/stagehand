import { isDeepStrictEqual } from "node:util";
import type { Page } from "../../dist/index.mjs";
import { z } from "zod/v4";
import type { Action } from "@browserbasehq/stagehand-protocol/types";

export const publicPages = {
  books: "https://books.toscrape.com/catalogue/category/books/travel_2/index.html",
  iana: "https://www.iana.org/help/example-domains",
} as const;

export const fixtureHtml = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Trail badge preview</title></head>
<body>
  <h1>Trail badge preview</h1>
  <section aria-labelledby="guest">
    <h2 id="guest">Guest badge</h2>
    <label>Display name <input id="guest-name"></label>
    <button id="guest-preview" type="button">Preview</button>
  </section>
  <section aria-labelledby="guide">
    <h2 id="guide">Trail guide badge</h2>
    <label>Display name <input id="guide-name"></label>
    <button id="guide-preview" type="button">Preview</button>
  </section>
  <output id="preview-counts">0,0</output>
  <script>
    const counts = [0, 0];
    for (const [i, name] of ["guest", "guide"].entries()) {
      document.getElementById(name + "-preview").addEventListener("click", () => {
        counts[i]++;
        document.getElementById("preview-counts").textContent = counts.join(",");
      });
    }
  </script>
</body></html>`;

type Site = keyof typeof publicPages;
type DomQuery = { selector: string; text?: string; afterHeading?: string; read?: "href" };
type ObserveCase = {
  operation: "observe";
  site: Site;
  target: DomQuery;
  expected: string[];
  methods?: string[];
};
type ExtractCase = {
  operation: "extract";
  site: Site;
  schema: z.ZodType;
  fields: Record<string, DomQuery>;
  expected: Record<string, string | string[]>;
};
type ActCase = {
  operation: "act";
  site: "fixture";
  expected: FixtureState;
};
export type Case = { id: string; instruction: string } & (ObserveCase | ExtractCase | ActCase);

const readingLinks = { selector: "main h2 + ul a", afterHeading: "Further Reading" };
const readingNames = [
  "IANA-managed Reserved Domains",
  "Special-Use Domain Names",
  "Reserved Top Level DNS Names",
];
const cleanFixture = { guest: "", guide: "", previewCounts: "0,0" };
const firstBook = `article.product_pod:has(h3 a[title="It's Only the Himalayas"])`;

export const cases: Case[] = [
  {
    id: "books-heading",
    site: "books",
    operation: "observe",
    instruction: 'Find the heading "Travel".',
    target: { selector: "h1,h2,h3,h4,h5,h6,[role=heading]", text: "Travel" },
    expected: ["Travel"],
    methods: ["click", "scrollto"],
  },
  {
    id: "books-breadcrumb",
    site: "books",
    operation: "observe",
    instruction: "Find the Books link in the breadcrumb trail.",
    target: { selector: ".breadcrumb a", text: "Books" },
    expected: ["Books"],
  },
  {
    id: "books-absent",
    site: "books",
    operation: "observe",
    instruction: 'Find the heading "Click and Collect".',
    target: { selector: "h1,h2,h3,h4,h5,h6,[role=heading]", text: "Click and Collect" },
    expected: [],
  },
  {
    id: "iana-further-reading",
    site: "iana",
    operation: "observe",
    instruction: "Find all links in the Further Reading section.",
    target: readingLinks,
    expected: readingNames,
  },
  {
    id: "books-price",
    site: "books",
    operation: "extract",
    instruction:
      'Extract the listed price of "It\'s Only the Himalayas" verbatim, including the currency symbol.',
    schema: z.object({ price: z.string() }),
    fields: { price: { selector: `${firstBook} .price_color` } },
    expected: { price: "£45.17" },
  },
  {
    id: "books-record",
    site: "books",
    operation: "extract",
    instruction:
      'For "It\'s Only the Himalayas", extract its listed price and availability verbatim.',
    schema: z.object({ price: z.string(), availability: z.string() }),
    fields: {
      price: { selector: `${firstBook} .price_color` },
      availability: { selector: `${firstBook} .availability` },
    },
    expected: { price: "£45.17", availability: "In stock" },
  },
  {
    id: "iana-reading-urls",
    site: "iana",
    operation: "extract",
    instruction:
      "Extract the absolute URLs of every link in the Further Reading section, in page order.",
    schema: z.object({ urls: z.array(z.url()) }),
    fields: { urls: { ...readingLinks, read: "href" } },
    expected: {
      urls: [
        "https://www.iana.org/domains/reserved",
        "https://www.iana.org/go/rfc6761",
        "https://www.iana.org/go/rfc2606",
      ],
    },
  },
  {
    id: "badge-fill",
    site: "fixture",
    operation: "act",
    instruction: 'Enter "Avery" in the Trail guide badge display name field.',
    expected: { ...cleanFixture, guide: "Avery" },
  },
  {
    id: "badge-preview",
    site: "fixture",
    operation: "act",
    instruction: "Click Preview in the Guest badge section.",
    expected: { ...cleanFixture, previewCounts: "1,0" },
  },
];

type FixtureState = { guest: string; guide: string; previewCounts: string };

export async function readFixture(page: Page): Promise<FixtureState> {
  return page.evaluate(() => ({
    guest: document.querySelector<HTMLInputElement>("#guest-name")!.value,
    guide: document.querySelector<HTMLInputElement>("#guide-name")!.value,
    previewCounts: document.querySelector("#preview-counts")!.textContent!,
  }));
}

async function readDom(
  page: Page,
  queries: DomQuery[],
  actions: Action[] = [],
  methods = ["click"],
) {
  return page.evaluate(
    ({ queries, actions, methods }) => {
      const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
      const visible = (el: Element) =>
        el.getClientRects().length > 0 &&
        getComputedStyle(el).visibility === "visible" &&
        !el.closest('[aria-hidden="true"]');
      const matches = queries.map(({ selector, text, afterHeading }) =>
        [...document.querySelectorAll(selector)].filter(
          (el) =>
            visible(el) &&
            (text === undefined || normalize(el.textContent ?? "") === text) &&
            (afterHeading === undefined ||
              normalize(el.closest("ul")?.previousElementSibling?.textContent ?? "") ===
                afterHeading),
        ),
      );
      return {
        values: matches.map((elements, i) =>
          elements.map((el) => {
            if (queries[i]?.read === "href") return (el as HTMLAnchorElement).href;
            return normalize(el.textContent ?? "");
          }),
        ),
        actionTargets: actions.map(({ selector, method, arguments: args }) => {
          if (!methods.includes(method?.toLowerCase() ?? "") || (args?.length ?? 0) !== 0)
            return -1;
          // These targets are in the main document. Resolve selectors to element identity.
          try {
            if (!selector.startsWith("xpath=")) {
              const nodes = document.querySelectorAll(selector.replace(/^css=/, ""));
              return nodes.length === 1 ? (matches[0] ?? []).indexOf(nodes[0]!) : -1;
            }
            const nodes = document.evaluate(
              selector.slice(6),
              document,
              null,
              XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            );
            if (nodes.snapshotLength !== 1) return -1;
            return (matches[0] ?? []).indexOf(nodes.snapshotItem(0) as Element);
          } catch {
            return -1;
          }
        }),
      };
    },
    { queries, actions, methods },
  );
}

export async function audit(page: Page, task: Case) {
  if (task.operation === "act") {
    const actual = await readFixture(page);
    return { pass: isDeepStrictEqual(actual, cleanFixture), actual };
  }
  if (task.operation === "observe") {
    const {
      values: [actual],
    } = await readDom(page, [task.target]);
    return { pass: isDeepStrictEqual(actual, task.expected), actual };
  }
  const fields = Object.entries(task.fields);
  const { values } = await readDom(
    page,
    fields.map(([, query]) => query),
  );
  const actual = Object.fromEntries(
    fields.map(([key], i) => [
      key,
      typeof task.expected[key] === "string" && values[i]?.length === 1 ? values[i][0] : values[i],
    ]),
  );
  return { pass: isDeepStrictEqual(actual, task.expected), actual };
}

export async function checkObservation(page: Page, task: ObserveCase, actions: Action[]) {
  const {
    values: [actual],
    actionTargets,
  } = await readDom(page, [task.target], actions, task.methods);
  const labelStable = isDeepStrictEqual(actual, task.expected);
  return {
    labelStable,
    pass:
      labelStable &&
      actionTargets.length === task.expected.length &&
      actionTargets.every((target) => target >= 0) &&
      new Set(actionTargets).size === task.expected.length,
    actionTargets,
  };
}
