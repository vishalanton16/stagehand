import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { chromium } from "playwright";
import { z } from "zod";

const captureIndexSchema = z
  .array(
    z.object({
      url: z.url(),
      file: z.string().endsWith(".html.gz"),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  )
  .min(1);

const decompress = promisify(gunzip);

export async function loadFixtureReplay(indexPath: string): Promise<ReadonlyMap<string, Buffer>> {
  const captures = captureIndexSchema.parse(JSON.parse(await readFile(indexPath, "utf8")));
  const documents = new Map<string, Buffer>();
  for (const { url, file, sha256 } of captures) {
    const documentUrl = new URL(url);
    if (!["http:", "https:"].includes(documentUrl.protocol) || documentUrl.hash) {
      throw new Error(`Expected an HTTP(S) fixture URL without a fragment: ${url}`);
    }
    if (documents.has(documentUrl.href)) throw new Error(`Duplicate fixture URL: ${url}`);
    const html = await decompress(await readFile(resolve(dirname(indexPath), file)));
    if (createHash("sha256").update(html).digest("hex") !== sha256) {
      throw new Error(`Fixture HTML digest mismatch: ${file}`);
    }
    documents.set(documentUrl.href, html);
  }
  return documents;
}

export async function attachFixtureReplay(
  cdpUrl: string,
  documents: ReadonlyMap<string, Buffer>,
  onServed?: (url: string) => void,
): Promise<() => Promise<void>> {
  const connection = await chromium.connectOverCDP(cdpUrl);
  try {
    const [context] = connection.contexts();
    if (!context) throw new Error("Fixture replay requires a default browser context");
    // Fulfill at the original URL so relative links, iframe origins, and URL graders still work.
    await context.route(
      (url) => documents.has(url.href),
      async (route) => {
        const request = route.request();
        const body = documents.get(request.url());
        if (body === undefined || !request.isNavigationRequest() || request.method() !== "GET") {
          await route.continue();
          return;
        }
        await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body });
        onServed?.(request.url());
      },
    );
  } catch (error) {
    await connection.close().catch(() => {});
    throw error;
  }
  return () => connection.close();
}
