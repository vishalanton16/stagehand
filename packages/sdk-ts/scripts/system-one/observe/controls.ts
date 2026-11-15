import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import OpenAI from "openai";
import { generateWithOpenAI } from "../../openaiStructuredGeneration.js";
import { archive, root } from "./common.js";
process.env.STAGEHAND_EXTENSION_DIRECTORY_PATH = join(root, "packages/extension/dist");
const { localBrowser, Stagehand } = await import("../../../src/index.js");
const dir = process.argv[2];
if (!dir) throw new Error("Expected new controls directory");
mkdirSync(dir);
const form =
  '<main><label>Email<input id="email" aria-label="Email"></label><section id="ignored"><label>Backup email<input id="backup" aria-label="Backup email"></label></section><select id="color" aria-label="Color"><option>Red</option><option>Green</option></select><button id="submit">Submit</button><input id="upload" type="file" aria-label="Upload file"></main><aside><input id="outside" aria-label="Outside field"></aside>';
const cases = [
  {
    name: "scope",
    html: form,
    instruction: "Find all text fields",
    scope: "main",
    ignore: "#ignored",
    ids: ["email"],
    methods: ["click", "fill", "type"],
  },
  {
    name: "iframe",
    html: '<main><iframe title="Contact" srcdoc="<label>Email<input id=inside aria-label=Email></label>"></iframe></main>',
    instruction: "Find the Email field inside the iframe",
    ids: ["inside"],
    methods: ["click", "fill", "type"],
  },
  {
    name: "shadow",
    html: '<div id="host"></div><script>document.querySelector("#host").attachShadow({mode:"open"}).innerHTML="<label>Email<input id=inside aria-label=Email></label>"</script>',
    instruction: "Find the Email field",
    ids: ["inside"],
    methods: ["click", "fill", "type"],
  },
  {
    name: "select",
    html: form,
    instruction: 'Select "Green" from the Color dropdown',
    ids: ["color"],
    methods: ["selectOptionFromDropdown"],
    arguments: ["Green"],
  },
  {
    name: "press",
    html: form,
    instruction: "Press Enter in the Email field",
    ids: ["email"],
    methods: ["press"],
    arguments: ["Enter"],
  },
  {
    name: "hover",
    html: form,
    instruction: "Hover over the Submit button",
    ids: ["submit"],
    methods: ["hover"],
  },
  {
    name: "double-click",
    html: form,
    instruction: "Double click the Submit button",
    ids: ["submit"],
    methods: ["doubleClick"],
  },
  {
    name: "upload-locate",
    html: form,
    instruction: "Find the file upload control",
    ids: ["upload"],
    methods: ["click"],
  },
  {
    name: "heading",
    html: '<h1 id="heading">Observe controls</h1><button id="next">Next</button>',
    instruction: "Find the main heading",
    ids: ["heading"],
    methods: undefined,
  },
  {
    name: "custom-instructions",
    html: form,
    instruction: "Find the Email field",
    systemPrompt: "Return only explicitly requested controls. Preserve all selector identities.",
    ids: ["email"],
    methods: ["click", "fill", "type"],
  },
  {
    name: "variables",
    html: form,
    instruction: "Fill the Email field with %email%",
    variables: { email: "observe-probe@example.test" },
    ids: ["email"],
    methods: ["fill", "type"],
    arguments: ["%email%"],
  },
  {
    name: "readonly",
    html: '<label>Account<input id="account" aria-label="Account" value="Read only" readonly></label>',
    instruction: "Find the Account field",
    ids: ["account"],
    methods: ["click", "fill", "type"],
  },
];
writeFileSync(join(dir, "frozen-cases.json"), JSON.stringify(cases, null, 2));
archive(dir, {
  kind: "controlled-observe-compatibility",
  arms: ["runtime", "luna"],
  cases: cases.map((c) => c.name),
  model: "pplx-decider-v1.3",
  llmModel: "openai/gpt-6-luna",
  gradersFrozenBeforeInference: true,
});
const gateway = new OpenAI({
  baseURL: process.env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1",
  apiKey: process.env.AI_GATEWAY_API_KEY,
  timeout: 45000,
  maxRetries: 0,
});
const browser = await localBrowser.launch({ headless: true });
try {
  for (const [index, test] of cases.entries())
    for (const arm of index % 2 ? ["luna", "runtime"] : ["runtime", "luna"]) {
      const logs: any[] = [];
      const stagehand = await Stagehand.create({
        browser,
        model: { generate: (p) => generateWithOpenAI(gateway, "openai/gpt-6-luna", p) },
        experimentalDecisions: {
          provider: "perplexity",
          apiKey: process.env.PERPLEXITY_API_KEY!,
          model: "pplx-decider-v1.3",
        },
        ...(test.systemPrompt ? { systemPrompt: test.systemPrompt } : {}),
        logging: {
          level: "info",
          onLog: (event) => {
            if (event.message.startsWith("Decisions observe")) logs.push(event);
          },
        },
      });
      const page = await browser.context.newPage();
      let result: any,
        error: string | undefined,
        ids: (string | null)[] = [],
        passed = false;
      try {
        await page.goto("data:text/html," + encodeURIComponent(test.html));
        await page.waitForTimeout(200);
        if (test.name === "iframe" || test.name === "shadow")
          await page.evaluate((kind: string) => {
            const root =
              kind === "iframe"
                ? (document.querySelector("iframe") as HTMLIFrameElement).contentDocument
                : document.querySelector("#host")!.shadowRoot;
            (root!.querySelector("#inside") as HTMLInputElement).value = "identity-inside";
          }, test.name);
        const before = await page.snapshot();
        writeFileSync(join(dir, `${test.name}-${arm}.before.json`), JSON.stringify(before));
        const options = {
          page,
          cache: false,
          timeout: 30000,
          ...(test.scope ? { locator: page.locator(test.scope) } : {}),
          ...(test.ignore ? { ignoreLocators: [page.locator(test.ignore)] } : {}),
          ...(test.variables ? { variables: test.variables } : {}),
        };
        result = await (arm === "runtime" ? stagehand.experimentalDecisions : stagehand).observe(
          test.instruction,
          options,
        );
        for (const action of result.data) {
          if (test.name === "iframe" || test.name === "shadow")
            ids.push(
              (await page.locator(action.selector).inputValue()) === "identity-inside"
                ? "inside"
                : null,
            );
          else
            ids.push(
              await page.evaluate((selector: string) => {
                const node = document.evaluate(
                  selector.replace(/^xpath=/, ""),
                  document,
                  null,
                  XPathResult.FIRST_ORDERED_NODE_TYPE,
                  null,
                ).singleNodeValue;
                return node instanceof Element ? node.id : (node?.parentElement?.id ?? null);
              }, action.selector),
            );
        }
        passed =
          JSON.stringify([...ids].sort((a, b) => String(a).localeCompare(String(b)))) ===
            JSON.stringify([...test.ids].sort((a, b) => a.localeCompare(b))) &&
          result.data.every(
            (a: any) =>
              (!test.methods || test.methods.includes(a.method)) &&
              (!test.arguments || JSON.stringify(test.arguments) === JSON.stringify(a.arguments)),
          );
      } catch (e) {
        error = String(e);
      } finally {
        await page.close();
        await stagehand.close();
      }
      const row = { case: test.name, arm, passed: passed && !error, ids, error, result, logs };
      appendFileSync(join(dir, "results.jsonl"), JSON.stringify(row) + "\n");
      process.stdout.write(
        JSON.stringify({ case: test.name, arm, passed: row.passed, ids, error }) + "\n",
      );
    }
  const keyOnly = await Stagehand.create({
    browser,
    experimentalDecisions: { apiKey: process.env.PERPLEXITY_API_KEY!, model: "pplx-decider-v1.3" },
    logging: { level: "off" },
  });
  const page = await browser.context.newPage();
  try {
    await page.goto(
      "data:text/html," +
        encodeURIComponent('<label>Email<input id="email" aria-label="Email"></label>'),
    );
    const result = await keyOnly.experimentalDecisions.observe("Find the Email field", {
      page,
      cache: false,
    });
    const id = await page.evaluate((selector: string) => {
      const node = document.evaluate(
        selector.replace(/^xpath=/, ""),
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
      ).singleNodeValue;
      return node instanceof Element ? node.id : null;
    }, result.data[0]!.selector);
    let missingFallback = false;
    try {
      await keyOnly.experimentalDecisions.observe("Press Enter in the Email field", {
        page,
        cache: false,
      });
    } catch (e) {
      missingFallback = /provider API key|model|inference/i.test(String(e));
    }
    appendFileSync(
      join(dir, "results.jsonl"),
      JSON.stringify({
        case: "key-only",
        arm: "runtime",
        passed: id === "email" && missingFallback,
        id,
        missingFallback,
        result,
      }) + "\n",
    );
  } finally {
    await page.close();
    await keyOnly.close();
  }
} finally {
  await browser.close();
}
