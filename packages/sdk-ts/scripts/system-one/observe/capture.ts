import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFacts } from "../../../../extension/services/decisions/actionFacts.js";
import {
  developmentTasks,
  confirmationTasks,
  confirmation2Tasks,
  confirmation3Tasks,
  todoItems,
} from "./tasks.js";
import { archive, hash, type ObserveLabel } from "./common.js";
import { waitForBenchmarkReady } from "./setup.js";

process.env.STAGEHAND_EXTENSION_DIRECTORY_PATH ??= fileURLToPath(
  new URL("../../../../extension/dist/", import.meta.url),
);
const { localBrowser, Stagehand } = await import("../../../src/index.js");
const dir = process.argv[2];
if (!dir) throw new Error("Expected new capture directory");
mkdirSync(dir);
const tasks = (
  process.env.OBSERVE_SET === "confirmation3"
    ? confirmation3Tasks
    : process.env.OBSERVE_SET === "confirmation2"
      ? confirmation2Tasks
      : process.env.OBSERVE_SET === "confirmation"
        ? confirmationTasks
        : developmentTasks
).filter(
  (t) => !process.env.OBSERVE_SITES || process.env.OBSERVE_SITES.split(",").includes(t.site),
);
writeFileSync(join(dir, "instructions.json"), JSON.stringify(tasks, null, 2));
const browser = await localBrowser.launch({ headless: true });
const stagehand = await Stagehand.create({ browser, logging: { level: "off" } });
const captures: object[] = [];
try {
  for (const site of new Set(tasks.map((t) => t.site))) {
    const page = await browser.context.newPage();
    let phase = "navigate";
    try {
      const siteTasks = tasks.filter((t) => t.site === site);
      await page.setViewportSize(1440, 1000);
      await page.goto(siteTasks[0]!.url, { waitUntil: "load", timeout: 30000 });
      if (site === "todo") {
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        for (const item of todoItems) {
          await page.locator(".new-todo").fill(item);
          await page.keyPress("Enter");
        }
      }
      await page.waitForTimeout(600);
      const readiness = await waitForBenchmarkReady(
        page,
        siteTasks.find((task) => task.gold !== null)?.gold,
      );
      phase = "snapshot";
      const start = performance.now();
      const snapshot = await page.snapshot();
      const snapshotMs = performance.now() - start;
      phase = "facts";
      const facts = await page.evaluate(readFacts, snapshot.xpathMap);
      phase = "labels";
      const labelsAndPaths = await page.evaluate(
        ({ paths, tasks }) => {
          const helpers = {
            canonicalPath(this: void, element: Element): string {
              const parts: string[] = [];
              for (let node: Element | null = element; node; node = node.parentElement) {
                const name = node.tagName.toLowerCase();
                const peers = node.parentElement
                  ? [...node.parentElement.children].filter((s) => s.tagName === node!.tagName)
                  : [node];
                parts.unshift(`${name}[${peers.indexOf(node) + 1}]`);
              }
              return "/" + parts.join("/");
            },
            visible(this: void, e: Element) {
              const r = e.getBoundingClientRect();
              const s = getComputedStyle(e);
              return (
                r.width > 0 &&
                r.height > 0 &&
                s.visibility !== "hidden" &&
                s.display !== "none" &&
                !e.closest('[hidden],[aria-hidden="true"]')
              );
            },
          };
          const canonical: Record<string, string> = {};
          for (const [id, path] of Object.entries(paths)) {
            try {
              const node = document.evaluate(
                path,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null,
              ).singleNodeValue;
              const el = node instanceof Element ? node : node?.parentElement;
              if (el)
                canonical[id] = helpers.canonicalPath(
                  el instanceof HTMLImageElement ? (el.closest("a") ?? el) : el,
                );
            } catch {}
          }
          const labels = tasks.map((task) => {
            const gold = task.gold
              ? [...document.querySelectorAll(task.gold)].filter(helpers.visible)
              : [];
            const allowed = task.allowed
              ? [...document.querySelectorAll(task.allowed)].filter(helpers.visible)
              : gold;
            const required = [...new Set(gold.map(helpers.canonicalPath))];
            const allowedPaths = [...new Set(allowed.map(helpers.canonicalPath))];
            const goldIds = Object.keys(canonical).filter((id) =>
              required.includes(canonical[id]!),
            );
            return {
              ...task,
              required,
              allowedPaths,
              goldIds,
              domCount: gold.length,
              available:
                task.gold === null ||
                (required.length > 0 &&
                  required.every((path) => Object.values(canonical).includes(path))),
            };
          });
          return { canonical, labels };
        },
        { paths: snapshot.xpathMap, tasks: siteTasks },
      );
      const data = {
        site,
        url: await page.url(),
        capturedAt: new Date().toISOString(),
        snapshotMs,
        ...snapshot,
        facts,
        editableIds: Object.entries(facts)
          .filter(([, f]) => f.editableRoot)
          .map(([id]) => id),
        canonical: labelsAndPaths.canonical,
      };
      if (!readiness.ready) for (const label of labelsAndPaths.labels) label.available = false;
      writeFileSync(join(dir, site + ".json"), JSON.stringify(data));
      writeFileSync(
        join(dir, site + ".labels.json"),
        JSON.stringify(labelsAndPaths.labels, null, 2),
      );
      phase = "screenshot";
      await page.screenshot({ path: join(dir, site + ".png") });
      const row = {
        site,
        readiness,
        snapshotHash: hash(JSON.stringify(data)),
        labelsHash: hash(readFileSync(join(dir, site + ".labels.json"))),
        characters: snapshot.formattedTree.length,
        tasks: labelsAndPaths.labels.map((l: ObserveLabel) => ({
          name: l.name,
          count: l.required.length,
          available: l.available,
        })),
      };
      captures.push(row);
      process.stdout.write(JSON.stringify(row) + "\n");
    } catch (error) {
      captures.push({
        site,
        phase,
        error: String(error),
        cause: error instanceof Error ? error.cause : undefined,
        stack: error instanceof Error ? error.stack : undefined,
      });
      process.stdout.write(JSON.stringify(captures.at(-1)) + "\n");
    } finally {
      await page.close();
    }
  }
} finally {
  await stagehand.close();
  await browser.close();
}
archive(dir, {
  kind: "observe-capture",
  viewport: [1440, 1000],
  setup: { todo: todoItems },
  captures,
  labelsFrozenBeforeInference: true,
});
