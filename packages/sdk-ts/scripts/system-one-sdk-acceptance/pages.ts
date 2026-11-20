import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { fingerprintFiles, readDirectoryFiles } from "../../../extension/buildFingerprint.ts";
import { localBrowser, Stagehand, type Page } from "../../dist/index.mjs";
import { audit, cases, fixtureHtml, publicPages } from "./cases.ts";

const dist = new URL("../../dist/", import.meta.url);
type Site = keyof typeof publicPages;

export const viewport = { width: 1440, height: 1000 };
export const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export const msSince = (start: number) => Math.round(performance.now() - start);

export async function buildIdentity() {
  // A runtime override could silently load a different extension from the one hashed here.
  if (process.env.STAGEHAND_EXTENSION_DIRECTORY_PATH?.trim())
    throw new Error("Unset STAGEHAND_EXTENSION_DIRECTORY_PATH to benchmark the bundled extension");
  const root = new URL("../../../../", import.meta.url);
  const extension = fingerprintFiles(
    await readDirectoryFiles(fileURLToPath(new URL("extension/", dist))),
  );
  const buildInfo = JSON.parse(
    await readFile(new URL("assets/extension-build.json", dist), "utf8"),
  );
  if (extension !== buildInfo.fingerprint)
    throw new Error("SDK extension bundle fingerprint mismatch");
  return {
    revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    sdk: sha256(await readFile(new URL("index.mjs", dist))),
    extension,
    lockfile: sha256(await readFile(new URL("pnpm-lock.yaml", root))),
  };
}

export const launch = () =>
  localBrowser.launch({
    headless: true,
    acceptDownloads: false,
    ...(process.env.SDK_ACCEPTANCE_CHROME
      ? { executablePath: process.env.SDK_ACCEPTANCE_CHROME }
      : {}),
  });

async function chromeVersion(browser: Awaited<ReturnType<typeof launch>>) {
  if (!browser.cdpUrl) throw new Error("Local browser has no CDP URL");
  const response = await fetch(new URL("/json/version", browser.cdpUrl), {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("Unable to read local Chrome version");
  return ((await response.json()) as { Browser: string }).Browser;
}

export async function navigate(page: Page, url: string) {
  await page.setViewportSize(viewport.width, viewport.height);
  const started = performance.now();
  const response = await page.goto(url, { waitUntil: "load", timeout: 20_000 });
  const finalUrl = await page.url();
  const status = response?.status();
  if (!response?.ok() || finalUrl !== url)
    throw new Error(`Unexpected navigation status ${status ?? "unavailable"} or changed URL`);
  return { url: finalUrl, status, navigationMs: msSince(started) };
}

export async function pageEvidence(page: Page, includeIframes: boolean) {
  const sampledAt = new Date().toISOString();
  const started = performance.now();
  const snapshot = await page.snapshot({ includeIframes, timeout: 10_000 });
  // Backend IDs are local to one browser. Hash the tree with IDs removed.
  const tree = snapshot.formattedTree.replace(/^(\s*)\[\d+-\d+\] /gm, "$1");
  return {
    sampledAt,
    snapshotMs: msSince(started),
    outlineSha256: sha256(tree),
    outlineBytes: Buffer.byteLength(tree),
  };
}

type ArchivePage = {
  site: Site;
  url: string;
  file: string;
  sha256: string;
  bytes: number;
};

export async function capture(dir: string) {
  const build = await buildIdentity();
  await mkdir(dir, { mode: 0o700 });
  const browser = await launch();
  try {
    await Stagehand.create({ browser, logging: { level: "off" } });
    const chrome = await chromeVersion(browser);
    const captures = [];
    for (const site of Object.keys(publicPages) as Site[]) {
      const page = await browser.context.newPage();
      try {
        const source = await navigate(page, publicPages[site]);
        const audited = [];
        for (const task of cases.filter((task) => task.site === site)) {
          const proof = await audit(page, task);
          if (!proof.pass)
            throw new Error(`Live label changed for ${task.id}: ${JSON.stringify(proof.actual)}`);
          audited.push({ id: task.id, ...proof });
        }
        const evidence = await pageEvidence(page, true);
        const html = await page.evaluate(() => {
          const root = document.documentElement.cloneNode(true) as HTMLElement;
          root
            .querySelectorAll("script,noscript,iframe,frame,object,embed,base,meta[http-equiv]")
            .forEach((node) => node.remove());
          const base = document.createElement("base");
          base.href = location.href;
          root.querySelector("head")!.prepend(base);
          return "<!doctype html>\n" + root.outerHTML;
        });
        const file = `${site}.html`;
        await writeFile(join(dir, file), html, { mode: 0o600, flag: "wx" });
        const row = {
          site,
          ...source,
          ...evidence,
          file,
          sha256: sha256(html),
          bytes: Buffer.byteLength(html),
          audited,
        };
        captures.push(row);
        process.stdout.write(JSON.stringify(row) + "\n");
      } finally {
        await page.close();
      }
    }
    await writeFile(
      join(dir, "capture.json"),
      JSON.stringify({ build, viewport, chrome, captures }, null, 2) + "\n",
      { mode: 0o600, flag: "wx" },
    );
  } finally {
    await browser.close();
  }
}

export async function loadArchive(dir: string) {
  const manifest = await readFile(join(dir, "capture.json"), "utf8");
  const { captures } = JSON.parse(manifest) as { captures: ArchivePage[] };
  const pages = new Map<Site, ArchivePage & { html: Buffer }>();
  for (const site of Object.keys(publicPages) as Site[]) {
    const matches = captures.filter((entry) => entry.site === site);
    const entry = matches[0];
    if (
      matches.length !== 1 ||
      !entry ||
      entry.url !== publicPages[site] ||
      entry.file !== `${site}.html`
    )
      throw new Error(`Capture manifest has no unique expected page for ${site}`);
    const html = await readFile(join(dir, entry.file));
    if (sha256(html) !== entry.sha256 || html.length !== entry.bytes)
      throw new Error(`Capture digest mismatch for ${site}`);
    pages.set(site, { ...entry, html });
  }
  return { pages, manifestSha256: sha256(manifest) };
}

export async function servePages(archive?: Awaited<ReturnType<typeof loadArchive>>) {
  const pages = new Map<string, { html: string | Buffer; policy: string }>([
    ["/fixture", { html: fixtureHtml, policy: "script-src 'unsafe-inline'; base-uri 'none'" }],
    ...[...(archive?.pages.values() ?? [])].map(
      ({ site, html, url }) =>
        [
          `/${site}`,
          { html, policy: `script-src 'none'; base-uri ${new URL(url).origin}` },
        ] as const,
    ),
  ]);
  const server = createServer((req, res) => {
    const page = req.method === "GET" ? pages.get(req.url ?? "") : undefined;
    if (!page) return void res.writeHead(404).end();
    res
      .writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": `default-src 'none'; form-action 'none'; style-src 'unsafe-inline'; img-src data:; ${page.policy}`,
        "Cache-Control": "no-store",
      })
      .end(page.html);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Loopback fixture server has no port");
  return { origin: `http://127.0.0.1:${address.port}`, close: () => server.close() };
}

export { chromeVersion };
