import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  candidates,
  type ActionSnapshot,
} from "../../../extension/services/decisions/actionPlans.ts";
import { scoreCandidates, type OutlineNode } from "../../../extension/services/decisions/tree.ts";

const base = "93b9d913281cd361a296f3126712827700215b53";
const cutoffs = [1, 5, 10, 30];
const budget = 30;
const splits = [
  { name: "act-development", directory: "system-one-corpus/runs/act/dev-capture-20261115" },
  {
    name: "act-confirmation-1",
    directory: "system-one-corpus/runs/act/confirmation-capture-20261115",
  },
  {
    name: "act-confirmation-2",
    directory: "system-one-corpus/runs/act/confirmation2-final-capture-20261115",
  },
  { name: "books-stress", directory: "observe-improvement/tuning-capture", site: "books" },
  { name: "shop-stress", directory: "observe-improvement/validation-capture", site: "shop" },
] as const;

type Capture = {
  site: string;
  hash?: string;
  snapshotHash?: string;
  labelsHash: string;
};
type Snapshot = ActionSnapshot & { canonical?: Record<string, string> };
type ArchivedLabel = {
  name: string;
  instruction?: string;
  available: boolean;
  gold: string | null;
  goldIds: string[];
  method?: "click" | "fill" | "selectOption";
  methods?: string[];
  workload?: "one" | "all" | "empty" | "discovery";
  required?: string[];
  requiredGroups?: string[][];
};
type RecordRef = { family: string; path: string };
type Candidate = {
  id: string;
  name: string;
  role: string;
  score: number;
  record?: RecordRef;
};
type RankInput = {
  instruction: string;
  kind: "pointer" | "input";
};
type Query = RankInput & {
  gold: string[][];
  single: boolean;
  negative: boolean;
  keyOf: (id: string) => string;
};

function readJson<T>(filename: string, expectedHash?: string): T {
  const body = readFileSync(filename);
  if (expectedHash)
    assert.equal(createHash("sha256").update(body).digest("hex"), expectedHash, filename);
  return JSON.parse(body.toString()) as T;
}

function recordRefs(nodes: OutlineNode[], xpathMap: Record<string, string>) {
  const families = new Map<string, Set<string>>();
  const pathsById = new Map<string, RecordRef[]>();
  for (const node of nodes) {
    const path = xpathMap[node.id] ?? "";
    const ancestors: RecordRef[] = [];
    for (const match of path.matchAll(/\/(li|tr|article)\[\d+\](?=\/|$)/g)) {
      const family = path.slice(0, match.index) + "/" + match[1];
      const record = path.slice(0, match.index + match[0].length);
      const siblings = families.get(family) ?? new Set<string>();
      siblings.add(record);
      families.set(family, siblings);
      ancestors.push({ family, path: record });
    }
    pathsById.set(node.id, ancestors);
  }
  return new Map(
    [...pathsById].map(([id, ancestors]) => [
      id,
      ancestors.findLast(({ family }) => families.get(family)!.size >= 3),
    ]),
  );
}

function diversifyTies(ranked: Candidate[]) {
  const seen = new Map<string, number>();
  const waves = ranked.map((candidate) => {
    if (!candidate.record) return { candidate, wave: 0 };
    const key = JSON.stringify([candidate.score, candidate.record.path]);
    const wave = seen.get(key) ?? 0;
    seen.set(key, wave + 1);
    return { candidate, wave };
  });
  return waves
    .sort((a, b) => b.candidate.score - a.candidate.score || a.wave - b.wave)
    .map(({ candidate }) => candidate);
}

function clippedTie(ranked: Candidate[], k: number) {
  const kept = new Map<string, Set<string>>();
  for (const [index, { name, role, score, record }] of ranked.entries()) {
    if (score <= 0 || !name || !record) continue;
    const key = JSON.stringify([score, role, name, record.family]);
    const paths = kept.get(key);
    if (index < k) {
      if (paths) paths.add(record.path);
      else kept.set(key, new Set([record.path]));
    } else if (paths && (paths.size > 1 || !paths.has(record.path))) {
      return true;
    }
  }
  return false;
}

function rank(snapshot: Snapshot, { instruction, kind }: RankInput) {
  const { nodes, eligible, selected } = candidates(snapshot, instruction, kind);
  const scores = scoreCandidates(nodes, eligible, instruction);
  const records = recordRefs(eligible, snapshot.xpathMap);
  const baseline = eligible
    .map((node) => ({
      id: node.id,
      name: node.name.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim(),
      role: node.role.toLowerCase(),
      score: scores.get(node.id) ?? 0,
      record: records.get(node.id),
    }))
    .sort((a, b) => b.score - a.score);
  const alternative = diversifyTies(baseline);

  assert.deepEqual(
    baseline
      .slice(0, budget)
      .map(({ id }) => id)
      .sort(),
    selected.map(({ id }) => id).sort(),
    "Baseline rank must reproduce production's shortlist",
  );
  assert.deepEqual(
    baseline.map(({ score }) => score),
    alternative.map(({ score }) => score),
  );
  return { baseline, alternative };
}

function resolveQuery(label: ArchivedLabel, snapshot: Snapshot, observe: boolean): Query {
  const negative = label.gold === null;
  assert(label.instruction, `Missing instruction for ${label.name}`);
  assert.equal(negative, label.goldIds.length === 0, label.name);
  if (!observe)
    return {
      instruction: label.instruction,
      kind: label.method === "fill" ? "input" : "pointer",
      gold: negative ? [] : [label.goldIds],
      single: true,
      negative,
      keyOf: (id) => id,
    };
  const canonical = snapshot.canonical;
  assert(label.required && canonical, label.name);
  return {
    instruction: label.instruction,
    kind: "pointer",
    gold: label.requiredGroups ?? label.required.map((path) => [path]),
    single: label.workload === "one",
    negative,
    keyOf: (id) =>
      canonical[id] ?? snapshot.xpathMap[id]?.replace(/\/text\(\)(?:\[\d+\])?$/iu, "") ?? id,
  };
}

function measure(ranked: Candidate[], query: Query) {
  const keys = ranked.map(({ id }) => query.keyOf(id));
  const relevant = new Set(query.gold.flat());
  const matches = ranked.filter(({ id }) => relevant.has(query.keyOf(id)));
  const first = keys.findIndex((key) => relevant.has(key)) + 1;
  const covered = (prefix: string[]) => {
    if (query.negative) return null;
    const retrieved = new Set(prefix);
    return query.gold.filter((group) => group.some((key) => retrieved.has(key))).length;
  };
  const goldRecord = matches[0]?.record;
  const topRecord = ranked[0]?.record;
  const wrongRecordAt1 =
    query.single && goldRecord && matches.every(({ record }) => record?.path === goldRecord.path)
      ? !relevant.has(keys[0]!) &&
        topRecord?.family === goldRecord.family &&
        topRecord.path !== goldRecord.path
      : null;
  return {
    eligible: ranked.length,
    goldTargets: query.gold.length,
    eligibleGold: covered(keys),
    firstRank: first || null,
    bestGoldScore: matches[0]?.score ?? null,
    rr: first > 0 && first <= budget ? 1 / first : 0,
    targetRecall: cutoffs.map((k) => {
      const count = covered(keys.slice(0, k));
      return count === null ? null : count / query.gold.length;
    }),
    clippedTie: cutoffs.map((k) => clippedTie(ranked, k)),
    wrongRecordAt1,
    topScore: ranked[0]?.score ?? null,
  };
}

type Row = {
  task: string;
  negative: boolean;
  workload: "one" | "all" | "empty";
  baseline: ReturnType<typeof measure>;
  alternative: ReturnType<typeof measure>;
};

function summarize(rows: Row[], arm: "baseline" | "alternative") {
  const positive = rows.filter((row) => !row.negative).map((row) => row[arm]);
  const negative = rows.filter((row) => row.negative).map((row) => row[arm]);
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    positives: positive.length,
    negatives: negative.length,
    noEligibleGold: positive.filter((result) => !result.eligibleGold).length,
    recall: cutoffs.map((_, i) => mean(positive.map((result) => result.targetRecall[i]!))),
    mrrAt30: mean(positive.map((result) => result.rr)),
    wrongRecordAt1: positive.filter((result) => result.wrongRecordAt1 === true).length,
    evaluableRecords: positive.filter((result) => result.wrongRecordAt1 !== null).length,
    positiveQueriesWithClippedTie: cutoffs.map(
      (_, i) => positive.filter((result) => result.clippedTie[i]).length,
    ),
    negativesWithPositiveTopScore: negative.filter((result) => (result.topScore ?? 0) > 0).length,
  };
}

const entry = (id: string, score: number, record?: string): Candidate => ({
  id,
  score,
  role: "button",
  name: "inspect",
  record: record ? { family: "sample", path: record } : undefined,
});
const ungrouped = [entry("a", 2), entry("b", 2), entry("c", 1)];
const tied = [entry("a", 2, "1"), entry("b", 2, "1"), entry("c", 2, "2"), entry("d", 1, "3")];
assert.deepEqual(diversifyTies(ungrouped), ungrouped);
assert.deepEqual(
  diversifyTies(tied).map(({ id }) => id),
  ["a", "c", "b", "d"],
);
assert(clippedTie(tied, 2) && !clippedTie(tied, 3));

const archive = process.argv[2];
assert(archive && process.argv.length === 3, "Usage: bun replay.ts /absolute/path/to/vendor-repos");
execFileSync(
  "git",
  [
    "diff",
    "--quiet",
    base,
    "--",
    "packages/extension/services/decisions",
    "packages/extension/handlers/handlerUtils/variables.ts",
  ],
  { cwd: fileURLToPath(new URL("../../../../", import.meta.url)) },
);
const results = splits.map((split) => {
  const directory = join(archive, split.directory);
  const manifest = readJson<{ captures: Capture[] }>(join(directory, "manifest.json"));
  const observe = "site" in split;
  const captures = manifest.captures.filter((capture) => !observe || capture.site === split.site);
  assert(captures.length, `No captures for ${split.name}`);
  const excluded: { task: string; reason: string }[] = [];
  const rows: Row[] = captures.flatMap((capture) => {
    const snapshotHash = capture.snapshotHash ?? capture.hash;
    assert(snapshotHash && capture.labelsHash, `Missing hashes for ${capture.site}`);
    const snapshot = readJson<Snapshot>(join(directory, `${capture.site}.json`), snapshotHash);
    const labels = readJson<ArchivedLabel[]>(
      join(directory, `${capture.site}.labels.json`),
      capture.labelsHash,
    );
    return labels.flatMap((label) => {
      const supported = observe
        ? label.workload === "empty" || label.methods?.includes("click") === true
        : label.method === "click" || label.method === "fill";
      if (!label.available || !supported) {
        excluded.push({
          task: label.name,
          reason: label.available ? "out of scope" : "unavailable",
        });
        return [];
      }
      const query = resolveQuery(label, snapshot, observe);
      const { baseline, alternative } = rank(snapshot, {
        instruction: query.instruction,
        kind: query.kind,
      });
      return [
        {
          task: label.name,
          negative: query.negative,
          workload: query.negative ? "empty" : query.single ? "one" : "all",
          baseline: measure(baseline, query),
          alternative: measure(alternative, query),
        },
      ];
    });
  });
  return {
    split: split.name,
    pages: captures.length,
    excluded,
    baseline: summarize(rows, "baseline"),
    alternative: summarize(rows, "alternative"),
    rows,
  };
});
process.stdout.write(JSON.stringify({ base, cutoffs, results }, null, 2) + "\n");
