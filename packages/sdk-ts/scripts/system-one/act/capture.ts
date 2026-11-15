import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFacts } from "./facts.js";
import { archiveSources } from "./archive.js";
import { developmentTasks, confirmationTasks, confirmation2Tasks } from "./tasks.js";
import {
  parseOutline,
  buildView,
  markEditable,
} from "../../../../extension/services/decisions/tree.js";

process.env.STAGEHAND_EXTENSION_DIRECTORY_PATH ??= fileURLToPath(
  new URL("../../../../extension/dist/", import.meta.url),
);
const { localBrowser, Stagehand } = await import("../../../src/index.js");
const dir = process.argv[2];
if (!dir) throw new Error("Expected a new capture directory");
mkdirSync(dir);
const tasks = (
  process.env.ACT_SET === "confirmation2"
    ? confirmation2Tasks
    : process.env.ACT_SET === "confirmation"
      ? confirmationTasks
      : developmentTasks
).filter((task) => !process.env.ACT_SITE || process.env.ACT_SITE.split(",").includes(task.site));
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
writeFileSync(join(dir, "instructions.json"), JSON.stringify(tasks, null, 2));
const browser = await localBrowser.launch({ headless: true });
const stagehand = await Stagehand.create({ browser, logging: { level: "off" } });
const captures: object[] = [];
try {
  for (const site of new Set(tasks.map((task) => task.site))) {
    const page = await browser.context.newPage();
    const siteTasks = tasks.filter((task) => task.site === site);
    try {
      await page.setViewportSize(1440, 1000);
      await page.goto(siteTasks[0]!.url, { waitUntil: "load", timeout: 30_000 });
      if (site === "todo") {
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        for (const text of ["review provider docs", "freeze page snapshot"]) {
          await page.locator(".new-todo").fill(text);
          await page.keyPress("Enter");
        }
      }
      await page.waitForTimeout(1000);
      const started = performance.now();
      const snapshot = await page.snapshot();
      const snapshotMs = performance.now() - started;
      const facts = await page.evaluate(readFacts, snapshot.xpathMap);
      const nodes = parseOutline(snapshot.formattedTree);
      const editableIds = Object.entries(facts)
        .filter(([, fact]) => fact.editable)
        .map(([id]) => id);
      markEditable(nodes, editableIds);
      const eligible = new Set(
        [
          ...buildView(nodes, "pointer"),
          ...buildView(nodes, "input"),
          ...buildView(nodes, "select"),
        ].map((node) => node.id),
      );
      const labels = [];
      for (const task of siteTasks) {
        const goldIds =
          task.gold === null
            ? []
            : await page.evaluate(
                ({ paths, selector }) => {
                  const gold = [...document.querySelectorAll(selector)];
                  return Object.entries(paths)
                    .filter(([, path]) => {
                      try {
                        const node = document.evaluate(
                          path,
                          document,
                          null,
                          XPathResult.FIRST_ORDERED_NODE_TYPE,
                          null,
                        ).singleNodeValue;
                        return gold.includes(node as Element);
                      } catch {
                        return false;
                      }
                    })
                    .map(([id]) => id);
                },
                { paths: snapshot.xpathMap, selector: task.gold },
              );
        const eligibleGold = goldIds.filter(
          (id) => eligible.has(id) && facts[id]?.visible && facts[id]?.enabled,
        );
        labels.push({
          ...task,
          goldIds,
          eligibleGold,
          available: task.gold === null || eligibleGold.length > 0,
        });
      }
      const data = {
        site,
        capturedAt: new Date().toISOString(),
        url: await page.url(),
        snapshotMs,
        ...snapshot,
        facts,
        editableIds,
      };
      const body = JSON.stringify(data);
      writeFileSync(join(dir, site + ".json"), body);
      writeFileSync(join(dir, site + ".labels.json"), JSON.stringify(labels, null, 2));
      await page.screenshot({ path: join(dir, site + ".png") });
      captures.push({
        site,
        hash: sha(body),
        labelsHash: sha(readFileSync(join(dir, site + ".labels.json"))),
        tasks: labels.map(({ name, available, eligibleGold }) => ({
          name,
          available,
          gold: eligibleGold.length,
        })),
      });
      process.stdout.write(JSON.stringify(captures.at(-1)) + "\n");
    } catch (error) {
      captures.push({ site, error: String(error) });
      process.stdout.write(JSON.stringify(captures.at(-1)) + "\n");
    } finally {
      await page.close();
    }
  }
} finally {
  await stagehand.close();
  await browser.close();
}
writeFileSync(
  join(dir, "manifest.json"),
  JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      viewport: { width: 1440, height: 1000 },
      setup:
        "todo: clear localStorage, add review provider docs and freeze page snapshot; other sites: navigation only",
      captures,
    },
    null,
    2,
  ),
);
archiveSources(dir);
