import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function archiveSources(dir: string) {
  const root = fileURLToPath(new URL("../../../../../", import.meta.url));
  const files = [
    ...readdirSync(join(root, "packages/extension/services/decisions"), {
      encoding: "utf8",
      withFileTypes: false,
    })
      .filter((name) => name.endsWith(".ts"))
      .map((name: string) => `packages/extension/services/decisions/${name}`),
    "packages/extension/services/actService.ts",
    "packages/extension/services/extractService.ts",
    "packages/extension/services/observeService.ts",
    "packages/extension/controllers/stagehandController.ts",
    "packages/extension/rpcRouter.ts",
    "packages/extension/inference.ts",
    "packages/extension/prompt.ts",
    "packages/protocol/schemas.ts",
    "packages/protocol/schema-registry.ts",
    "packages/sdk-ts/src/experimentalDecisions.ts",
    "packages/sdk-python/src/stagehand/experimental_decisions.py",
    ...["cleanupActions", "cleanupSmoke", "cleanupOperations", "prepareBaseline", "baseline"].map(
      (name) => `packages/sdk-ts/scripts/system-one/${name}.ts`,
    ),
    ...["capture", "live", "replay", "tasks", "archive", "workflows", "mutations", "controls"].map(
      (name) => `packages/sdk-ts/scripts/system-one/act/${name}.ts`,
    ),
  ];
  const sourceHashes: Record<string, string> = {};
  for (const file of files) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const data = readFileSync(path);
    const output = join(dir, "source", file);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, data);
    sourceHashes[file] = createHash("sha256").update(data).digest("hex");
  }
  const path = join(dir, "manifest.json");
  writeFileSync(
    path,
    JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), sourceHashes }, null, 2),
  );
}
