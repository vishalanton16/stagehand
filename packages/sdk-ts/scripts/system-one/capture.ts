import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { localBrowser, Stagehand } from "../../src/index.js";
import * as corpus from "./corpus.js";
import { heldoutTasks } from "./heldout.js";
import { heldout2Tasks } from "./heldout2.js";
import { heldout3Tasks } from "./heldout3.js";
import { heldout4Tasks } from "./heldout4.js";

import { heldout5Tasks } from "./heldout5.js";
import { heldout7Tasks } from "./heldout7.js";
import { confirmationTasks, heldout6Tasks } from "./heldout6.js";

export const corpusTasks = [
  ...corpus.tasks,
  ...heldoutTasks,
  ...heldout2Tasks,
  ...heldout3Tasks,
  ...heldout4Tasks,
  ...heldout5Tasks,
  ...heldout6Tasks,
  ...heldout7Tasks,
  ...confirmationTasks,
];

export const CORPUS_DIR = new URL("../../../../vendor-repos/system-one-corpus/", import.meta.url);

const EVAL_ORIGIN = "https://stagehand-eval-sites.vercel.app";
const CHALLENGE =
  /Vercel Security Checkpoint|Just a moment|security verification|Too Many Requests/i;

const normalize = (xpath: string) => xpath.replaceAll("[1]", "").replace(/\/$/, "");

/** The subtree of an indented outline rooted at the node whose xpath matches `scope`. */
export function scopeTree(tree: string, xpathMap: Record<string, string>, scope: string): string {
  const wanted = normalize(scope);
  const id = Object.entries(xpathMap).find(([, xpath]) => normalize(xpath) === wanted)?.[0];
  if (!id) throw new Error(`No node for scope ${scope}`);
  const lines = tree.split("\n");
  const start = lines.findIndex((line) => line.trimStart().startsWith(`[${id}]`));
  if (start === -1) throw new Error(`Scope node ${id} missing from tree`);
  const indent = (line: string) => line.length - line.trimStart().length;
  const depth = indent(lines[start]!);
  let end = start + 1;
  while (end < lines.length && indent(lines[end]!) > depth) end++;
  return lines
    .slice(start, end)
    .map((line) => line.slice(depth))
    .join("\n");
}

/**
 * Eval sites are static SingleFile pages behind a bot checkpoint that blocks
 * headless Chrome, so each one is downloaded once and served locally; live
 * pages are loaded directly.
 */
async function serveEvalSites() {
  const htmlDir = new URL("html/", CORPUS_DIR);
  mkdirSync(htmlDir, { recursive: true });
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://local").pathname;
    const file = new URL(`${path.replace(/\W+/g, "_")}.html`, htmlDir);
    if (!existsSync(file)) return void response.writeHead(404).end();
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    close: () => server.close(),
    async localUrl(url: string) {
      const path = new URL(url).pathname;
      const file = new URL(`${path.replace(/\W+/g, "_")}.html`, htmlDir);
      if (!existsSync(file)) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
        writeFileSync(file, await response.text());
      }
      return origin + path;
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(CORPUS_DIR, { recursive: true });
  const only = process.env.CORPUS_TASK?.split(",");
  const sites = await serveEvalSites();
  const browser = await localBrowser.launch({ headless: true });
  try {
    const stagehand = await Stagehand.create({ browser, logging: { level: "off" } });
    try {
      const page = await browser.context.newPage();
      for (const task of corpusTasks) {
        if (only && !only.includes(task.name)) continue;
        try {
          const local = task.url.startsWith(EVAL_ORIGIN);
          await page.goto(local ? await sites.localUrl(task.url) : task.url, {
            waitUntil: "load",
            timeout: 30_000,
          });
          await new Promise((resolve) => setTimeout(resolve, 1_500));
          let snapshot = await page.snapshot();
          if (CHALLENGE.test(snapshot.formattedTree.slice(0, 300))) {
            throw new Error("Bot checkpoint");
          }
          if (local) {
            snapshot = JSON.parse(JSON.stringify(snapshot).replaceAll(sites.origin, EVAL_ORIGIN));
          }
          const tree = task.scope
            ? scopeTree(snapshot.formattedTree, snapshot.xpathMap, task.scope)
            : snapshot.formattedTree;
          writeFileSync(
            new URL(`${task.name}.json`, CORPUS_DIR),
            JSON.stringify({
              name: task.name,
              url: task.url,
              capturedAt: new Date().toISOString(),
              tree,
              ...snapshot,
            }),
          );
          process.stdout.write(`${task.name} ${tree.length} chars\n`);
        } catch (error) {
          process.stderr.write(
            `${task.name} FAILED ${error instanceof Error ? error.message : String(error)}\n`,
          );
          process.exitCode = 1;
        }
      }
    } finally {
      await stagehand.close();
    }
  } finally {
    await browser.close();
    sites.close();
  }
}
