import { trace } from "@opentelemetry/api";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { StagehandLogger } from "../../../extension/logger.js";
import { runDecisionsExtract } from "../../../extension/services/decisions/extract.js";
import { runWithProgress } from "../../../extension/understudy/progress.js";

const [vendorArgument, outputArgument, suite = "heldout", roundArgument = "1"] =
  process.argv.slice(2);
const rounds = Number(roundArgument);
if (
  !vendorArgument ||
  !outputArgument ||
  !["heldout", "coverage"].includes(suite) ||
  !Number.isInteger(rounds) ||
  rounds < 1 ||
  rounds > 2
) {
  throw new Error("Usage: replay.ts <vendor-repos> <new-output-dir> [heldout|coverage] [rounds=1]");
}
const apiKey = process.env.PERPLEXITY_API_KEY;
if (!apiKey) throw new Error("PERPLEXITY_API_KEY is required");

const vendor = resolve(vendorArgument);
const output = resolve(outputArgument);
const graderDir = join(vendor, "experimental-decisions/packages/sdk-ts/scripts/system-one");
const models = ["pplx-decider-v1.3", "pplx-decider-flash-v1.3"];
const heldout = [
  "hold7_sqlite_storage_classes",
  "hold7_kubernetes_pod_phases",
  "hold7_postgres_range_names",
  "hold7_wasm_number_types",
  "hold7_github_repo_qualifiers",
  "hold5_html_tables",
  "hold5_postgres_sections",
  "hold5_tld_list",
  "hold6_curl_protocols",
  "hold6_rust_types",
  "confirm_nginx_signals",
  "hold5_sqlite_limits",
  "hold5_rfc_absence",
  "hold5_nist_temp",
  "hold6_nasa_mars",
  "hold6_economics_school",
];
const coverage = [
  "promotion_sqlite_date_functions",
  "live_docker_container_filters",
  "live_iana_media",
  "live_kubernetes_services",
  "live_mdn_promise_methods",
  "live_w3c_landmarks",
];
const selected = suite === "coverage" ? coverage : heldout;
type FrozenTask = {
  name: string;
  kind: "list" | "scalar";
  instruction: string;
  schema: { toJSONSchema(): Parameters<typeof runDecisionsExtract>[1]["schema"] };
  grade(data: unknown): string | undefined;
};
type FrozenSnapshot = {
  tree: string;
  xpathMap: Record<string, string>;
  urlMap: Record<string, string>;
};

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const gradeFiles =
  suite === "coverage" ? ["liveCoverageTasks.ts"] : ["heldout5.ts", "heldout6.ts", "heldout7.ts"];
const graders = await Promise.all(
  gradeFiles.map(async (file) => {
    const path = join(graderDir, file);
    const module = await import(pathToFileURL(path).href);
    return {
      file,
      sha256: digest(readFileSync(path)),
      tasks: Object.values(module).flat() as FrozenTask[],
    };
  }),
);
const cases = selected.map((name) => {
  const task = graders.flatMap((grader) => grader.tasks).find((task) => task.name === name);
  if (!task) throw new Error(`Unknown frozen task ${name}`);
  const snapshotBytes = readFileSync(join(vendor, "system-one-corpus", `${name}.json`));
  return {
    task,
    sha256: digest(snapshotBytes),
    snapshot: JSON.parse(snapshotBytes.toString()) as FrozenSnapshot,
  };
});

mkdirSync(output, { mode: 0o700 });
const git = (...args: string[]) => execFileSync("git", args);
const production = [
  "packages/extension/services/decisions/",
  "packages/extension/understudy/progress.ts",
];
writeFileSync(
  join(output, "source.tar.gz"),
  git("archive", "--format=tar.gz", "HEAD", ...production),
);
writeFileSync(join(output, "source.patch"), git("diff", "--binary", "HEAD", "--", ...production));
writeFileSync(
  join(output, "manifest.json"),
  JSON.stringify(
    {
      revision: git("rev-parse", "HEAD").toString().trim(),
      scriptSha256: digest(readFileSync(new URL(import.meta.url))),
      suite,
      rounds,
      models,
      graders: graders.map(({ file, sha256 }) => ({ file, sha256 })),
      captures: cases.map(({ task, sha256 }) => ({ name: task.name, sha256 })),
      timeoutMs: 20_000,
      concurrency: 2,
    },
    null,
    2,
  ),
);

const fetchProvider = globalThis.fetch;
const maximumRequests = rounds * cases.length * models.length * 8;
let attempts = 0;
globalThis.fetch = (...args) => {
  if (attempts >= maximumRequests) throw new Error("provider request budget exhausted");
  attempts++;
  return fetchProvider(...args);
};
const tracer = trace.getTracer("system-one-extract-replay");
const queue = Array.from({ length: rounds }, (_, round) =>
  cases.map((entry, index) => ({ ...entry, round, index })),
).flat();
let next = 0;
async function work() {
  for (let item = queue[next++]; item; item = queue[next++]) {
    const { task, snapshot, round, index } = item;
    for (const model of (index + round) % 2 ? models.toReversed() : models) {
      const logs: unknown[] = [];
      const providerUsage: { inputTokens: number; outputTokens: number }[] = [];
      const logger = new StagehandLogger({ tracer }, (log) => logs.push(log), undefined, "debug");
      const started = performance.now();
      const result = await runWithProgress({ name: "extract", timeout: 20_000 }, (progress) =>
        runDecisionsExtract(
          {
            provider: "perplexity",
            model,
            apiKey,
            signal: progress.signal,
            recordDecisionUsage: (usage) => providerUsage.push(usage),
          },
          {
            logger,
            progress,
            instruction: task.instruction,
            schema: task.schema.toJSONSchema(),
            snapshot: {
              combinedTree: snapshot.tree,
              combinedXpathMap: snapshot.xpathMap,
              combinedUrlMap: snapshot.urlMap,
            },
          },
        ),
      ).catch(() => ({ kind: "error" as const }));
      const ms = Math.round(performance.now() - started);
      const grade = result.kind === "done" ? task.grade(result.data) : undefined;
      const outcome =
        result.kind === "done" ? (grade === undefined ? "correct" : "wrong") : result.kind;
      const summary = { task: task.name, workload: task.kind, round, model, ms, outcome };
      writeFileSync(
        join(output, "results.jsonl"),
        JSON.stringify({ ...summary, result, grade, providerUsage, logs }) + "\n",
        { flag: "a", mode: 0o600 },
      );
      process.stdout.write(JSON.stringify(summary) + "\n");
    }
  }
}
await Promise.all([work(), work()]);
writeFileSync(join(output, "attempts.json"), JSON.stringify({ attempts, maximumRequests }));
