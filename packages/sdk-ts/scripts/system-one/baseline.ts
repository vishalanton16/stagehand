import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

export const BASELINE_REVISION = "9080038614bcaf5ee32afad44970f282ad0c73bd";
const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const baseline = resolve(
  repository,
  "vendor-repos/system-one-corpus/runs/cleanup/2026-11-15/baseline",
);

/** Historical algorithms are available to research without entering the production import graph. */
export async function baselineModule(relative: string) {
  const source = resolve(baseline, "packages/extension", `${relative}.ts`);
  if (!existsSync(source))
    throw new Error(
      `Missing baseline ${BASELINE_REVISION}. Restore the source archive documented in CLEANUP_RESULTS.md before running a historical arm.`,
    );
  return import(pathToFileURL(source).href);
}
