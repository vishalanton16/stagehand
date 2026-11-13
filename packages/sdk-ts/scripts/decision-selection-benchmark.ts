import { trace } from "@opentelemetry/api";
import { StagehandLogger } from "../../extension/logger.js";
import {
  decide,
  type DecisionModelConfig,
  type DecisionQuestion,
  type JsonValue,
} from "../../extension/services/decisions/client.js";
import { pickCandidate } from "../../extension/services/decisions/pick.js";
import {
  buildView,
  describeCandidate,
  parseOutline,
  scoreCandidates,
} from "../../extension/services/decisions/tree.js";
import { localBrowser, Stagehand } from "../src/index.js";

const env = process.env;
const configs: Record<string, DecisionModelConfig> = {
  jev: { apiKey: env.TYPESAFE_API_KEY! },
  clef: {
    provider: "cloudflare",
    apiKey: env.CLOUDFLARE_AUTH_TOKEN!,
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    model: "clef-flash",
  },
  decider: {
    provider: "perplexity",
    apiKey: env.PERPLEXITY_API_KEY!,
    model: "pplx-decider-latest",
  },
  flash: {
    provider: "perplexity",
    apiKey: env.PERPLEXITY_API_KEY!,
    model: "pplx-decider-flash-latest",
  },
};
const controls = (labels: string[]) =>
  labels.map((label, i) => `<button id="target-${i}">${label}</button>`).join("");
const pairs = (a: string, b: string, label: string) =>
  `<section><h2>${a}</h2><button id="target-0">${label}</button></section><section><h2>${b}</h2><button id="target-1">${label}</button></section>`;
type Fixture = {
  name: string;
  html: string;
  prompt: string;
  target: string | null;
  split: "development" | "holdout";
  operation?: "fill";
};
const fixtures: Fixture[] = [
  {
    name: "checkout",
    html: controls(["Continue shopping", "Checkout"]),
    prompt: "Click Checkout",
    target: "target-1",
    split: "development",
  },
  {
    name: "team-settings",
    html: pairs("Personal", "Workspace", "Settings"),
    prompt: "Open the workspace settings",
    target: "target-1",
    split: "development",
  },
  {
    name: "missing",
    html: controls(["Export CSV", "Import CSV", "Print"]),
    prompt: "Click Export PDF",
    target: null,
    split: "development",
  },
  {
    name: "fill-email",
    html: '<label>Email<input id="target-0"></label><label>Full name<input id="target-1"></label>',
    prompt: "Fill the Email field",
    target: "target-0",
    split: "development",
    operation: "fill",
  },
  {
    name: "invoice",
    html: pairs("Invoice 417", "Invoice 471", "Download"),
    prompt: "Download invoice 471",
    target: "target-1",
    split: "holdout",
  },
  {
    name: "order",
    html: pairs("Order B784", "Order B748", "Details"),
    prompt: "Show details for order B784",
    target: "target-0",
    split: "holdout",
  },
  {
    name: "billing-missing",
    html: pairs("Billing profile", "Security profile", "Edit"),
    prompt: "Open the Shipping profile editor",
    target: null,
    split: "holdout",
  },
  {
    name: "large-catalog",
    html: controls([...Array.from({ length: 45 }, (_, i) => `Open plan ${i}`), "Compare plans"]),
    prompt: "Click Compare plans",
    target: "target-45",
    split: "holdout",
  },
  {
    name: "ambiguous",
    html: controls(["Approve", "Approve"]),
    prompt: "Click Approve",
    target: null,
    split: "holdout",
  },
  {
    name: "paraphrase",
    html: controls(["Archive invoice", "Send a copy", "View transaction"]),
    prompt: "Email a duplicate of the invoice",
    target: "target-1",
    split: "holdout",
  },
  {
    name: "fill-shipping",
    html: '<section><h2>Billing</h2><label>Postal code<input id="target-0"></label></section><section><h2>Shipping</h2><label>Postal code<input id="target-1"></label></section>',
    prompt: "Fill in the shipping postal code",
    target: "target-1",
    split: "holdout",
    operation: "fill",
  },
  {
    name: "disabled",
    html: '<button id="target-0" disabled>Download receipt</button><button id="target-1">Download statement</button>',
    prompt: "Download the receipt",
    target: null,
    split: "holdout",
  },
  {
    name: "search",
    html: '<label>Search settings<input id="target-0"></label><label>Search documentation<input id="target-1"></label><button id="target-2">Search</button>',
    prompt: "Enter text in the documentation search box",
    target: "target-1",
    split: "holdout",
    operation: "fill",
  },
  {
    name: "unicode",
    html: pairs("München", "Zürich", "Details"),
    prompt: "Open the details for Zürich",
    target: "target-1",
    split: "holdout",
  },
];
const browser = await localBrowser.launch({ headless: true });
const stagehand = await Stagehand.create({ browser, logging: { level: "off" } });
const logger = new StagehandLogger(
  { tracer: trace.getTracer("decision-benchmark") },
  () => {},
  undefined,
  "off",
);
try {
  const page = await browser.context.newPage();
  for (const fixture of fixtures) {
    if (env.BENCHMARK_SPLIT && fixture.split !== env.BENCHMARK_SPLIT) continue;
    await page.goto("data:text/html;charset=utf-8," + encodeURIComponent(fixture.html));
    const { formattedTree: tree, xpathMap } = await page.snapshot();
    const nodes = parseOutline(tree);
    const candidates = buildView(nodes, fixture.operation === "fill" ? "input" : "pointer");
    const xpathIds = Object.fromEntries(
      await page.evaluate<[string, string][]>(
        `${JSON.stringify(Object.entries(xpathMap))}.map(([id,path])=>{try{return [id,document.evaluate(path,document,null,XPathResult.FIRST_ORDERED_NODE_TYPE,null).singleNodeValue?.id||""]}catch{return [id,""]}})`,
      ),
    );
    const enabled = new Set(
      await page.evaluate<string[]>(
        'Array.from(document.querySelectorAll("button:not(:disabled),input:not(:disabled)"), node => node.id)',
      ),
    );
    const shortlistFor = (kind: "input" | "pointer") => {
      const view = buildView(nodes, kind).filter(({ id }) => enabled.has(xpathIds[id]));
      const scores = scoreCandidates(nodes, view, fixture.prompt);
      return view.toSorted((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0)).slice(0, 8);
    };
    const shortlist = shortlistFor(fixture.operation === "fill" ? "input" : "pointer");
    const snap = { tree, xpathMap, nodes };
    const expected = fixture.target;
    for (const [provider, base] of Object.entries(configs)) {
      if (!base.apiKey || (env.BENCHMARK_PROVIDER && provider !== env.BENCHMARK_PROVIDER)) continue;
      const arms = [
        "control",
        "ranked-control",
        "full-single",
        "ranked-single",
        "compact-single",
        "joint",
      ] as const;
      for (const arm of arms) {
        if (env.BENCHMARK_ARM && env.BENCHMARK_ARM !== arm) continue;
        const pool = arm === "control" || arm === "full-single" ? candidates : shortlist;
        const options = env.BENCHMARK_REVERSE === "1" ? pool.toReversed() : pool;
        const tokenCalls: [number, number][] = [];
        const config = {
          ...base,
          recordDecisionUsage: ({
            inputTokens,
            outputTokens,
          }: {
            inputTokens: number;
            outputTokens: number;
          }) => tokenCalls.push([inputTokens, outputTokens]),
        };
        const start = performance.now();
        let selected: string | undefined;
        let confidence: number | undefined;
        let model: string | undefined;
        let error: string | undefined;
        try {
          const instructions = "Which element matches the user's requested target?";
          if (arm === "control" || arm === "ranked-control") {
            const result = await pickCandidate(
              {
                config,
                instruction: fixture.prompt,
                trace: [],
                threshold: 0.7,
                logger,
                ensureTimeRemaining: () => {},
              },
              "target",
              snap,
              options,
              instructions,
            );
            if (result.accepted) selected = result.picked?.id;
            confidence = result.best;
          } else if (options.length) {
            const operation = fixture.operation ?? "click";
            const none = "no_match";
            const question = (pool: typeof options, wording = instructions): DecisionQuestion => ({
              type: "choice",
              instructions: wording,
              criteria: {
                ...Object.fromEntries(
                  pool.map((node) => [
                    node.id,
                    arm === "compact-single" || arm === "joint"
                      ? {
                          role: node.role,
                          name: node.name,
                          heading: describeCandidate(nodes, node).under_heading ?? null,
                        }
                      : describeCandidate(nodes, node),
                  ]),
                ),
                [none]: "No unique enabled element matches",
              } satisfies Record<string, JsonValue>,
            });
            const questions: Record<string, DecisionQuestion> =
              arm === "joint"
                ? {
                    operation: {
                      type: "choice",
                      instructions: "Which operation does the instruction ask for?",
                      criteria: {
                        click: "Activate an element",
                        fill: "Enter text into an editable field",
                        none: "Neither operation",
                      },
                    },
                    click: question(
                      shortlistFor("pointer"),
                      "If activating an element, which target matches the request?",
                    ),
                    fill: question(
                      shortlistFor("input"),
                      "If entering text, which editable field matches the request?",
                    ),
                  }
                : { target: question(options) };
            const result = await decide(config, { instruction: fixture.prompt }, questions);
            model = result.model;
            const intent = result.answers.operation;
            const choice =
              result.answers[
                arm === "joint" && intent?.type === "choice" ? intent.choice : "target"
              ];
            if (choice?.type === "choice") {
              confidence = choice.probabilities[choice.choice] ?? choice.confidence;
              if (
                choice.choice !== none &&
                confidence >= 0.7 &&
                (arm !== "joint" || (intent?.type === "choice" && intent.choice === operation))
              )
                selected = choice.choice;
            }
          }
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }
        const selectionMs = performance.now() - start;
        const target = selected ? (xpathIds[selected] ?? null) : null;
        let executed: string | undefined;
        const executionStart = performance.now();
        try {
          if (target && enabled.has(target)) {
            await page.evaluate(
              'document.body.dataset.hit = ""; document.body.onclick = event => { document.body.dataset.hit = event.target.id; };',
            );
            const locator = page.locator(`xpath=${xpathMap[selected!]}`);
            if (fixture.operation === "fill") {
              await locator.fill("test", { timeout: 2000 });
              if ((await locator.inputValue()) === "test") executed = target;
              await locator.fill("", { timeout: 2000 });
            } else {
              await locator.click({ timeout: 2000 });
              executed = await page.evaluate<string>("document.body.dataset.hit");
            }
          }
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }
        const executionMs = performance.now() - executionStart;
        process.stdout.write(
          JSON.stringify({
            fixture: fixture.name,
            split: fixture.split,
            provider,
            model,
            arm,
            expected,
            target,
            executed,
            confidence,
            error,
            selectionMs,
            executionMs,
            tokenCalls,
            candidates: options.length,
            recall: expected === null ? null : options.some(({ id }) => xpathIds[id] === expected),
          }) + "\n",
        );
      }
    }
  }
} finally {
  await stagehand.close();
  await browser.close();
}
