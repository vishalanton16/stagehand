import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFacts } from "../../../extension/services/decisions/actionFacts.js";
import type { ObservationSnapshot } from "../../../extension/services/decisions/observeCandidates.js";
import { parseOutline } from "../../../extension/services/decisions/outline.js";
import defaultPages from "./pages.json" with { type: "json" };

const [dir, pagesFile] = process.argv.slice(2);
if (!dir || !resolve(dir).split("/").includes("vendor-repos")) {
  throw new Error("Pass a new capture directory under vendor-repos/");
}
const pages = pagesFile
  ? (JSON.parse(await readFile(pagesFile, "utf8")) as Record<string, string>)
  : defaultPages;

process.env.STAGEHAND_EXTENSION_DIRECTORY_PATH ??= fileURLToPath(
  new URL("../../../extension/dist/", import.meta.url),
);
const { localBrowser, Stagehand } = await import("../../src/index.js");
const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const viewport = { width: 1440, height: 1000 };
await mkdir(dir, { mode: 0o700 });

type Capture = {
  site: string;
  requestedUrl: string;
} & (
  | {
      url: string;
      capturedAt: string;
      sha256: string;
      bytes: number;
      snapshotMs: number;
      outlineNodes: number;
      frameOrdinals: number;
    }
  | { phase: string; error: string }
);

const browser = await localBrowser.launch({ headless: true });
let stagehand;
try {
  stagehand = await Stagehand.create({ browser, logging: { level: "off" } });
  const captures: Capture[] = [];

  for (const [site, requestedUrl] of Object.entries(pages)) {
    const page = await browser.context.newPage();
    let phase = "navigation";
    try {
      await page.setViewportSize(viewport.width, viewport.height);
      await page.goto(requestedUrl, { waitUntil: "load", timeout: 25_000 });
      const url = await page.url();
      phase = "snapshot";
      const started = performance.now();
      const snapshot = await page.snapshot({ includeIframes: true, timeout: 15_000 });
      const snapshotMs = Math.round(performance.now() - started);

      phase = "evidence";
      // The public snapshot exposes combined XPaths. Read relative paths in each same-origin frame.
      const facts = await page.evaluate<ObservationSnapshot["facts"]>(
        `((paths) => {
          const groups = new Map();
          for (const [id, path] of Object.entries(paths)) {
            const steps = path.split(/(\\/(?:iframe|frame)\\[\\d+\\])(?=\\/html\\[)/i);
            let frame = window;
            try {
              for (let i = 0; i < steps.length - 1; i += 2) {
                frame = frame.document.evaluate(
                  steps[i] + steps[i + 1], frame.document, null,
                  frame.XPathResult.FIRST_ORDERED_NODE_TYPE, null
                ).singleNodeValue?.contentWindow;
                if (!frame) break;
              }
              if (!frame?.document) continue;
              if (!groups.has(frame)) groups.set(frame, {});
              groups.get(frame)[id] = steps.at(-1);
            } catch {
              // Cross-origin frames remain in the snapshot with unresolved evidence.
            }
          }
          const result = {};
          for (const [frame, paths] of groups) {
            const { document, XPathResult, Element, HTMLElement, HTMLAnchorElement } = frame;
            const getComputedStyle = frame.getComputedStyle.bind(frame);
            Object.assign(result, (${readFacts.toString()})(paths));
          }
          return result;
        })(${JSON.stringify(snapshot.xpathMap)})`,
      );
      const outlineIds = new Set(parseOutline(snapshot.formattedTree).map((node) => node.id));
      // Page.snapshot omits the internal AX editable side channel. Preserve DOM editor roots.
      const editableIds = Object.keys(facts).filter((id) => facts[id]!.editableRoot);
      const observation: ObservationSnapshot = {
        ...snapshot,
        url,
        editableIds,
        facts: Object.fromEntries(
          Object.entries(facts).filter(([id, fact]) => outlineIds.has(id) || fact.editableRoot),
        ),
      };

      phase = "archive";
      const data = JSON.stringify(observation);
      const sha256 = createHash("sha256").update(data).digest("hex");
      await writeFile(join(dir, `${sha256}.json`), data, { flag: "wx", mode: 0o600 });
      const row = {
        site,
        requestedUrl,
        url,
        capturedAt: new Date().toISOString(),
        sha256,
        bytes: Buffer.byteLength(data),
        snapshotMs,
        outlineNodes: outlineIds.size,
        frameOrdinals: new Set([...outlineIds].map((id) => id.split("-")[0])).size,
      };
      captures.push(row);
      process.stdout.write(JSON.stringify(row) + "\n");
    } catch (error) {
      const row = {
        site,
        requestedUrl,
        phase,
        error: error instanceof Error ? error.name : "Error",
      };
      captures.push(row);
      process.stderr.write(JSON.stringify(row) + "\n");
      process.exitCode = 1;
    } finally {
      await page.close();
    }
  }

  await writeFile(
    join(dir, "capture.json"),
    JSON.stringify({ revision, viewport, captures }, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
} finally {
  try {
    await stagehand?.close();
  } finally {
    await browser.close();
  }
}
