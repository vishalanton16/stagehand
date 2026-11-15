import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { generateWithOpenAI } from "../../openaiStructuredGeneration.js";
import { archiveSources } from "./archive.js";

process.env.STAGEHAND_EXTENSION_DIRECTORY_PATH ??= fileURLToPath(
  new URL("../../../../extension/dist/", import.meta.url),
);
const { localBrowser, Stagehand } = await import("../../../src/index.js");
const dir = process.argv[2];
if (!dir) throw new Error("Expected a new workflow result directory");
mkdirSync(dir);
const cases = [
  {
    name: "todo-cycle",
    url: "https://demo.playwright.dev/todomvc/",
    instructions: [
      'Fill the new todo field with "write benchmark report".',
      "Press Enter.",
      'Mark the todo "write benchmark report" as completed.',
      "Show only completed todos using the Completed filter.",
    ],
    expected: "One completed write benchmark report item, Completed filter selected",
  },
  {
    name: "django-tutorial",
    url: "https://www.djangoproject.com/",
    instructions: [
      "Open the Django documentation using the Documentation navigation link.",
      "Open Writing your first Django app, part 1.",
    ],
    expected: "docs.djangoproject.com path contains /intro/tutorial01/",
  },
];
writeFileSync(
  join(dir, "manifest.json"),
  JSON.stringify(
    {
      kind: "live-workflow-regression",
      rounds: 2,
      arms: ["luna", "plans"],
      cases,
      navigation:
        "Initial URL only. Every scored step uses the same natural-language act instruction across arms. No manual navigation or selectors replace failed steps.",
    },
    null,
    2,
  ),
);
archiveSources(dir);
const gateway = new OpenAI({
  baseURL: process.env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1",
  apiKey: process.env.AI_GATEWAY_API_KEY,
  maxRetries: 0,
  timeout: 40_000,
});
const browser = await localBrowser.launch({ headless: true });
try {
  for (let round = 0; round < 2; round++)
    for (const scenario of cases) {
      const arms = round % 2 ? ["plans", "luna"] : ["luna", "plans"];
      for (const arm of arms) {
        const calls: object[] = [],
          decisions: object[] = [],
          steps: object[] = [];
        const stagehand = await Stagehand.create({
          browser,
          model: {
            generate: (params) =>
              generateWithOpenAI(gateway, "openai/gpt-6-luna", params, (usage) =>
                calls.push({ usage }),
              ),
          },
          experimentalDecisions: {
            provider: "perplexity",
            apiKey: process.env.PERPLEXITY_API_KEY!,
            model: "pplx-decider-v1.3",
          },
          logging: {
            level: "info",
            onLog: (event) => {
              if (event.message === "Decision model usage") decisions.push(event.data);
            },
          },
        });
        const page = await browser.context.newPage();
        let passed = false,
          error: string | undefined,
          ms = 0;
        try {
          await page.setViewportSize(1440, 1000);
          await page.goto(scenario.url, { waitUntil: "load", timeout: 30_000 });
          if (scenario.name === "todo-cycle") {
            await page.evaluate(() => localStorage.clear());
            await page.reload();
          }
          const start = performance.now();
          for (const [index, instruction] of scenario.instructions.entries()) {
            const before = await page.snapshot();
            writeFileSync(
              join(dir, `${scenario.name}-${arm}-${round}-step${index}.json`),
              JSON.stringify({ instruction, ...before }),
            );
            const mark = performance.now();
            const result = await (arm === "luna" ? stagehand : stagehand.experimentalDecisions).act(
              instruction,
              { page, cache: false, timeout: 30_000 },
            );
            const url = await page.url();
            steps.push({ instruction, ms: performance.now() - mark, result, url });
            if (!result.data.success) throw new Error(`Step ${index + 1} failed`);
            if (
              scenario.name === "django-tutorial" &&
              index === 0 &&
              !url.includes("docs.djangoproject.com")
            )
              throw new Error("First documentation navigation went elsewhere");
          }
          const finalUrl = await page.url();
          if (scenario.name === "django-tutorial")
            passed =
              finalUrl.includes("docs.djangoproject.com") &&
              finalUrl.includes("/intro/tutorial01/");
          else
            passed = await page.evaluate(() => {
              const rows = [...document.querySelectorAll(".todo-list li")];
              return (
                location.hash === "#/completed" &&
                rows.length === 1 &&
                rows[0]!.querySelector("label")?.textContent === "write benchmark report" &&
                Boolean((rows[0]!.querySelector(".toggle") as HTMLInputElement)?.checked)
              );
            });
          ms = performance.now() - start;
          await page.screenshot({ path: join(dir, `${scenario.name}-${arm}-${round}.png`) });
        } catch (cause) {
          error = String(cause);
        } finally {
          const row = {
            task: scenario.name,
            arm,
            round,
            passed,
            ms,
            error,
            steps,
            calls,
            decisions,
          };
          appendFileSync(join(dir, "results.jsonl"), JSON.stringify(row) + "\n");
          process.stdout.write(
            JSON.stringify({ task: scenario.name, arm, round, passed, ms: Math.round(ms), error }) +
              "\n",
          );
          await page.close();
          await stagehand.close();
        }
      }
    }
} finally {
  await browser.close();
}
