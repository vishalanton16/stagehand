import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { archiveSources } from "./act/archive.js";
import { z } from "zod/v4";

process.env.STAGEHAND_EXTENSION_DIRECTORY_PATH ??= fileURLToPath(
  new URL("../../../extension/dist/", import.meta.url),
);
const { localBrowser, Stagehand } = await import("../../src/index.js");
const output = process.argv[2];
if (!output) throw new Error("Expected a new smoke result directory");
mkdirSync(output);
const html = '<h1>Account</h1><label>Name<input id="name"></label><p>Status: Ready</p>';
const instructions = {
  act: 'Fill Name with "fresh evidence".',
  extract: "Copy the account status.",
};
writeFileSync(
  join(output, "manifest.json"),
  JSON.stringify(
    {
      kind: "decision-key-only-sdk",
      html,
      instructions,
      expected: { name: "fresh evidence", status: "Ready" },
      provider: "perplexity",
      model: "pplx-decider-v1.3",
    },
    null,
    2,
  ),
);
archiveSources(output);
const browser = await localBrowser.launch({ headless: true });
const logs: object[] = [];
const stagehand = await Stagehand.create({
  browser,
  experimentalDecisions: { apiKey: process.env.PERPLEXITY_API_KEY! },
  logging: { level: "info", onLog: (log) => logs.push(log) },
});
try {
  const page = await browser.context.newPage();
  await page.goto("data:text/html," + encodeURIComponent(html));
  writeFileSync(join(output, "before.json"), JSON.stringify(await page.snapshot()));
  const act = await stagehand.experimentalDecisions.act(instructions.act, {
    page,
    cache: false,
    timeout: 20_000,
  });
  assert.equal(act.data.success, true);
  assert.equal(await page.locator("#name").inputValue(), "fresh evidence");
  const extract = await stagehand.experimentalDecisions.extract(
    instructions.extract,
    z.object({ status: z.string() }),
    { page, cache: false, timeout: 20_000 },
  );
  assert.equal(extract.data.status, "Ready");
  await assert.rejects(
    stagehand.experimentalDecisions.act("Press Enter", { page, cache: false, timeout: 20_000 }),
    /configured LLM model or Browserbase gateway for fallback/,
  );
  await assert.rejects(
    stagehand.experimentalDecisions.observe("Find Name", { page }),
    /LLM was not configured/,
  );
  writeFileSync(
    join(output, "results.json"),
    JSON.stringify({ passed: true, act, extract, logs }, null, 2),
  );
  process.stdout.write(
    "Decision-key-only act/extract passed; unsupported action and observation require fallback credentials.\n",
  );
} finally {
  await stagehand.close();
  await browser.close();
}
