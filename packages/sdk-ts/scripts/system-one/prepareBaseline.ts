import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BASELINE_REVISION } from "./baseline.js";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const output = join(root, "vendor-repos/system-one-corpus/runs/cleanup/2026-11-15");
const baseline = join(output, "baseline");
mkdirSync(baseline, { recursive: true });
const archive = join(output, "baseline-complete-source.tar.gz");
if (!existsSync(archive)) {
  execFileSync(
    "git",
    [
      "archive",
      "--format=tar.gz",
      "--output",
      archive,
      BASELINE_REVISION,
      "packages/extension",
      "packages/protocol",
      "packages/sdk-ts",
      "packages/sdk-python",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "tsconfig.json",
      "vitest.config.ts",
    ],
    { cwd: root },
  );
}
execFileSync("tar", ["-xf", archive, "-C", baseline]);
for (const name of ["extension", "protocol", "sdk-ts"]) {
  const installed = join(root, "packages", name, "node_modules");
  const destination = join(baseline, "packages", name, "node_modules");
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(installed)) {
    const link = join(destination, entry);
    if (entry !== "@browserbasehq") {
      if (!existsSync(link)) symlinkSync(join(installed, entry), link, "dir");
      continue;
    }
    mkdirSync(link, { recursive: true });
    for (const scoped of readdirSync(join(installed, entry))) {
      const target =
        scoped === "stagehand-protocol"
          ? join(baseline, "packages/protocol")
          : join(installed, entry, scoped);
      if (!existsSync(join(link, scoped))) symlinkSync(target, join(link, scoped), "dir");
    }
  }
}
const manifest = {
  revision: BASELINE_REVISION,
  archive: "baseline-complete-source.tar.gz",
  sha256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
  dependencyLock: createHash("sha256")
    .update(readFileSync(join(baseline, "pnpm-lock.yaml")))
    .digest("hex"),
};
writeFileSync(join(output, "baseline-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
process.stdout.write(JSON.stringify(manifest) + "\n");
