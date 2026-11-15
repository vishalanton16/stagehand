import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function archiveSources(dir: string) {
  const root = fileURLToPath(new URL("../../../../../", import.meta.url));
  const files = [
    ...[
      "actionPlans",
      "actionFacts",
      "actionGuard",
      "pipeline",
      "pick",
      "tree",
      "client",
      "providers",
      "args",
    ].map((name) => `packages/extension/services/decisions/${name}.ts`),
    "packages/extension/services/actService.ts",
    "packages/extension/inference.ts",
    "packages/extension/prompt.ts",
    "packages/protocol/schemas.ts",
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
