import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as candidate from "../../../extension/services/decisions/actionPlans.ts";
import type {
  ActionPlan,
  ActionSnapshot,
} from "../../../extension/services/decisions/actionPlans.ts";

const base = "aec9cb750";
const [archive, mode, suite = "holdout"] = process.argv.slice(2);
assert(
  archive &&
    (!mode || mode === "--offline" || mode === "--live") &&
    ["holdout", "holdout2", "legacy"].includes(suite),
);
const here = (name: string) => new URL(name, import.meta.url);

function load<T>(path: string | URL, sha?: string): T {
  const bytes = readFileSync(path);
  if (sha) assert.equal(createHash("sha256").update(bytes).digest("hex"), sha, String(path));
  return JSON.parse(bytes.toString());
}

type Capture = {
  site: string;
  sha256: string;
  snapshotHash?: string;
  hash?: string;
  labelsHash: string;
};
type Job = {
  name: string;
  split: string;
  snapshot: ActionSnapshot;
  instruction: string;
  method: ActionPlan["method"];
  args: string[];
  gold: string[][];
  keyOf: (id: string) => string;
  stress?: boolean;
};

function keyOf(snapshot: ActionSnapshot, id: string) {
  const path = snapshot.xpathMap[id]?.replace(/\/text\(\)(?:\[\d+\])?$/u, "");
  return path ? JSON.stringify([id.split("-")[0], path]) : id;
}

function captureJob(
  snapshot: ActionSnapshot,
  split: string,
  name: string,
  instruction: string,
  ids: string[],
  method: ActionPlan["method"] = "click",
  args: string[] = [],
): Job {
  assert(snapshot.url.startsWith("https:") || split === "compatibility", name);
  if (split !== "compatibility")
    for (const id of ids) assert(snapshot.xpathMap[id] && snapshot.facts[id]?.visible, name);
  const physical = (id: string) => keyOf(snapshot, id);
  return {
    name,
    split,
    snapshot,
    instruction,
    method,
    args,
    keyOf: physical,
    gold: ids.length ? [ids.map(physical)] : [],
  };
}

function holdout() {
  const { captures } = load<{ captures: Capture[] }>(here("../system-one-study/manifest.json"));
  const labels = load<Record<string, [string, string | null][]>>(here("./holdout.json"));
  return Object.entries(labels).flatMap(([site, cases]) => {
    const sha = captures.find((capture) => capture.site === site)!.sha256;
    const snapshot = load<ActionSnapshot>(
      join(archive!, "system-one-corpus/decisions-beta-93b9d9132-capture-v2", `${sha}.json`),
      sha,
    );
    return cases.map(([instruction, id], i) =>
      captureJob(
        snapshot,
        site === "books" ? "title-control" : "holdout",
        `${site}-${i + 1}`,
        instruction,
        id ? [id] : [],
      ),
    );
  });
}

function holdout2() {
  const labels = load<
    Record<string, { path: string; sha256: string; cases: [string, string | null][] }>
  >(here("./holdout2.json"));
  return Object.entries(labels).flatMap(([site, { path, sha256, cases }]) => {
    const snapshot = load<ActionSnapshot>(join(archive!, path), sha256);
    return cases.map(([instruction, id], i) =>
      captureJob(
        snapshot,
        site === "django" ? "title-control" : "holdout2",
        `${site}-${i + 1}`,
        instruction,
        id ? [id] : [],
      ),
    );
  });
}

type Label = {
  name: string;
  instruction?: string;
  available: boolean;
  method?: ActionPlan["method"];
  goldIds: string[];
  requiredGroups?: string[][];
  required: string[];
  value?: string;
};

function legacy() {
  const folders = [
    "dev-capture-20261115",
    "confirmation-capture-20261115",
    "confirmation2-final-capture-20261115",
  ];
  const jobs = folders.flatMap((folder) => {
    const directory = join(archive!, "system-one-corpus/runs/act", folder);
    const { captures } = load<{ captures: Capture[] }>(join(directory, "manifest.json"));
    return captures.flatMap(({ site, snapshotHash, hash, labelsHash }) => {
      assert(snapshotHash || hash);
      assert(labelsHash);
      const snapshot = load<ActionSnapshot>(join(directory, `${site}.json`), snapshotHash ?? hash);
      const labels = load<Label[]>(join(directory, `${site}.labels.json`), labelsHash);
      return labels.flatMap(({ name, available, method, instruction, goldIds, value }) =>
        available && instruction && (method === "click" || method === "fill")
          ? [
              captureJob(
                snapshot,
                "compatibility",
                name,
                instruction,
                goldIds,
                method,
                value === undefined ? [] : [value],
              ),
            ]
          : [],
      );
    });
  });
  const sections = JSON.parse(
    execFileSync(
      "git",
      ["show", "834519580:packages/sdk-ts/scripts/system-one-act-round2/sections.json"],
      { encoding: "utf8" },
    ),
  ) as Record<string, { split: string; sha256: string; cases: [string, string[]][] }>;
  for (const [site, { split, sha256, cases }] of Object.entries(sections)) {
    const snapshot = load<ActionSnapshot>(
      join(archive!, "system-one-study-2026-11-20/section-capture", `${sha256}.json`),
      sha256,
    );
    for (const [i, [instruction, ids]] of cases.entries()) {
      jobs.push(captureJob(snapshot, split, `${site}-${i + 1}`, instruction, ids));
    }
  }

  const dir = join(archive!, "observe-improvement/tuning-capture");
  const { captures } = load<{ captures: Capture[] }>(join(dir, "manifest.json"));
  const { snapshotHash, labelsHash } = captures.find(({ site }) => site === "books")!;
  assert(snapshotHash && labelsHash);
  const snapshot = load<ActionSnapshot & { canonical?: Record<string, string> }>(
    join(dir, "books.json"),
    snapshotHash,
  );
  const books = load<Label[]>(join(dir, "books.labels.json"), labelsHash).find(
    ({ name }) => name === "books-products",
  )!;
  jobs.push({
    ...captureJob(snapshot, "stress", books.name, books.instruction!, []),
    gold: books.requiredGroups ?? books.required.map((path) => [path]),
    keyOf: (id) => snapshot.canonical?.[id] ?? snapshot.xpathMap[id] ?? id,
    stress: true,
  });
  return jobs;
}

function matches(plan: ActionPlan, job: Job, group: string[]) {
  return (
    plan.method === job.method &&
    JSON.stringify(plan.arguments) === JSON.stringify(job.args) &&
    group.includes(job.keyOf(plan.nodeId))
  );
}

const dir = mkdtempSync(fileURLToPath(here("../../../extension/services/decisions/.act-replay-")));
try {
  const baselinePath = join(dir, "actionPlans.ts");
  const source = execFileSync(
    "git",
    ["show", `${base}:packages/extension/services/decisions/actionPlans.ts`],
    { encoding: "utf8" },
  ).replace(/from "\.\//gu, 'from "../');
  writeFileSync(baselinePath, source);
  const baseline: typeof candidate = await import(pathToFileURL(baselinePath).href);
  const jobs = suite === "holdout" ? holdout() : suite === "holdout2" ? holdout2() : legacy();
  const changed: Job[] = [];
  for (const job of jobs) {
    const { name, split, snapshot, instruction, method, gold } = job;
    const kind = method === "click" ? "pointer" : "input";
    const prior = baseline.buildPlans(snapshot, instruction);
    const next = candidate.buildPlans(snapshot, instruction);
    const { context, eligible } = candidate.candidates(snapshot, instruction, "pointer");
    const activated = Boolean(context && eligible.some((node) => context(node)));
    if (!activated) assert.deepEqual(next, prior, name);
    const changedPlans = !isDeepStrictEqual(prior, next);
    if (!job.stress && snapshot.url.startsWith("https://") && changedPlans) changed.push(job);
    const cover = (arm: typeof candidate) =>
      [1, 5, 30].map((limit) => {
        const keys = new Set(
          arm
            .candidates(snapshot, instruction, kind, limit)
            .selected.map(({ id }) => job.keyOf(id)),
        );
        return gold.filter((group) => group.some((key) => keys.has(key))).length;
      });
    process.stdout.write(
      JSON.stringify({
        name,
        split,
        activated,
        changedPlans,
        gold: gold.length,
        baseline: cover(baseline),
        candidate: cover(candidate),
        offered: [prior, next].map(
          (plans) => gold.filter((group) => plans.some((plan) => matches(plan, job, group))).length,
        ),
      }) + "\n",
    );
  }
  if (mode === "--live") {
    const apiKey = process.env.PERPLEXITY_API_KEY;
    assert(apiKey);
    const fetchLive = globalThis.fetch;
    const maxAttempts = suite === "legacy" ? 96 : 64;
    assert(changed.length * 4 <= maxAttempts);
    let attempts = 0;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      assert.equal(url, "https://api.perplexity.ai/v1/decisions");
      assert(++attempts <= maxAttempts, "Provider attempt limit");
      return await fetchLive(input, init);
    }) as typeof fetch;

    async function run(arm: typeof candidate, armName: string, job: Job, round: number) {
      let result;
      try {
        result = await arm.choosePlan(
          {
            apiKey,
            provider: "perplexity",
            model: "pplx-decider-v1.3",
            signal: AbortSignal.timeout(20_000),
          },
          job.snapshot,
          job.instruction,
        );
      } catch (error) {
        process.stdout.write(
          JSON.stringify({
            name: job.name,
            split: job.split,
            arm: armName,
            round,
            status: "error",
            error: error instanceof Error ? error.name : "unknown",
          }) + "\n",
        );
        return;
      }
      const { plan, confidence, response } = result;
      const status = !plan
        ? "abstained"
        : job.gold.length === 1 && matches(plan, job, job.gold[0]!)
          ? "correct"
          : "wrong";
      process.stdout.write(
        JSON.stringify({
          name: job.name,
          split: job.split,
          arm: armName,
          round,
          status,
          confidence,
          target: plan?.nodeId,
          ms: response?.durationMs,
          usage: response?.usage,
        }) + "\n",
      );
    }
    for (const round of [1, 2]) {
      for (let start = 0; start < changed.length; start += 4) {
        await Promise.all(
          changed.slice(start, start + 4).map(async (job, offset) => {
            const arms =
              (start + offset + round) % 2
                ? ([
                    ["baseline", baseline],
                    ["candidate", candidate],
                  ] as const)
                : ([
                    ["candidate", candidate],
                    ["baseline", baseline],
                  ] as const);
            for (const [name, arm] of arms) await run(arm, name, job, round);
          }),
        );
      }
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
