import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, expect, it } from "vitest";
import { loadFixtureReplay } from "../../framework/fixtureReplay.js";

const url = "https://fixture.example/sites/cart/";
const html = "<html><body><a href='checkout.html'>Checkout</a></body></html>";
const sha256 = createHash("sha256").update(html).digest("hex");
let directory: string;
let index: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "stagehand-fixtures-"));
  index = join(directory, "capture-index.json");
  await writeFile(join(directory, "cart.html.gz"), gzipSync(html));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it("loads verified HTML bytes under the captured URL", async () => {
  await writeFile(index, JSON.stringify([{ url, file: "cart.html.gz", sha256 }]));
  const documents = await loadFixtureReplay(index);
  expect(documents).toEqual(new Map([[url, Buffer.from(html)]]));
});

it("rejects a capture whose content has changed", async () => {
  await writeFile(index, JSON.stringify([{ url, file: "cart.html.gz", sha256: "0".repeat(64) }]));
  await expect(loadFixtureReplay(index)).rejects.toThrow("Fixture HTML digest mismatch");
});
