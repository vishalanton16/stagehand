import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Action } from "@browserbasehq/stagehand-protocol/types";
import type { DecisionModelConfig } from "../../../extension/services/decisions/client.js";
import type { ObservationSnapshot } from "../../../extension/services/decisions/observeCandidates.js";
import { selectObservation } from "../../../extension/services/decisions/observeSelection.js";
import { trimTrailingTextNode } from "../../../extension/utils.js";
import { loadFreshCorpus } from "./fresh.js";
import {
  decodeGatewayDecision,
  encodeGatewayDecision,
  GATEWAY_MODELS,
  GATEWAY_ROOT,
} from "./gateway.js";
import { selectJointObservation } from "./joint.js";
import { ORDINARY_MODEL, selectOrdinaryObservation } from "./ordinary.js";

type Snapshot = ObservationSnapshot & { canonical: Record<string, string> };
type Label = {
  name: string;
  workload: string;
  instruction?: string;
  available: boolean;
  required: string[];
  requiredGroups?: string[][];
  allowedPaths: string[];
  methods?: string[];
  arguments?: string[];
};

const SELECTORS = { staged: selectObservation, joint: selectJointObservation } as const;
const MODELS = [
  { provider: "perplexity", model: "pplx-decider-v1.3", key: "PERPLEXITY_API_KEY" },
  { provider: "perplexity", model: "pplx-decider-flash-v1.3", key: "PERPLEXITY_API_KEY" },
  { provider: "typesafe", model: "jev-1.14.0", key: "TYPESAFE_API_KEY" },
  { provider: "cloudflare", model: "clef-flash", key: "CLOUDFLARE_AUTH_TOKEN" },
  ...GATEWAY_MODELS.map(
    (model) =>
      ({ provider: "perplexity", model, key: "AI_GATEWAY_API_KEY", apiUrl: GATEWAY_ROOT }) as const,
  ),
  { provider: "perplexity", model: ORDINARY_MODEL, key: "AI_GATEWAY_API_KEY" },
] as const;

function grade(actions: Action[], label: Label, snapshot: Snapshot) {
  const canonicals = new Map(
    Object.entries(snapshot.xpathMap).map(([id, xpath]) => [
      trimTrailingTextNode(xpath),
      snapshot.canonical[id] ?? xpath,
    ]),
  );
  const targets = actions.map(({ selector }) => {
    const xpath = selector.replace(/^xpath=/, "");
    return canonicals.get(xpath) ?? xpath;
  });
  const selected = new Set(targets);
  const groups = label.requiredGroups ?? label.required.map((path) => [path]);
  const missing = groups.filter((group) => !group.some((path) => selected.has(path))).length;
  const allowed = new Set(label.allowedPaths);
  const extra = targets.filter((target) => !allowed.has(target)).length;
  const duplicates = targets.length - selected.size;
  const badActions = actions.filter(
    (action) =>
      (label.methods && !label.methods.includes(action.method ?? "")) ||
      (label.arguments &&
        JSON.stringify(action.arguments ?? []) !== JSON.stringify(label.arguments)),
  ).length;
  return {
    passed: !(missing || extra || duplicates || badActions),
    missing,
    extra,
    duplicates,
    badActions,
  };
}

const [archive, output, roundsString, ...requestedModels] = process.argv.slice(2);
const rounds = Number(roundsString ?? 1);
if (!archive || !output || !Number.isSafeInteger(rounds) || rounds < 1 || rounds > 3) {
  throw new Error(
    "Usage: replay.ts <public-capture-archive> <new-output-dir> [rounds=1] [model ...]",
  );
}
const models = requestedModels.length
  ? MODELS.filter(({ model }) => requestedModels.includes(model))
  : MODELS.slice(0, 2);
if (requestedModels.length && models.length !== requestedModels.length) {
  throw new Error("Unknown or repeated model filter");
}

const arms = models.flatMap((route) => {
  const { model, provider, key } = route;
  const apiKey =
    process.env[key] ?? (provider === "cloudflare" ? process.env.CLOUDFLARE_API_TOKEN : undefined);
  const accountId = provider === "cloudflare" ? process.env.CLOUDFLARE_ACCOUNT_ID : undefined;
  if (!apiKey || (provider === "cloudflare" && !accountId))
    throw new Error(`Missing config for ${model}`);
  const config: DecisionModelConfig = {
    model,
    provider,
    apiKey,
    accountId,
    ...("apiUrl" in route ? { apiUrl: route.apiUrl } : {}),
  };
  const selectors = model === ORDINARY_MODEL ? { ordinary: selectOrdinaryObservation } : SELECTORS;
  return Object.entries(selectors).map(([arm, run]) => ({ arm, run, model, config }));
});

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const files = readdirSync(archive)
  .filter((file) => file.endsWith(".labels.json"))
  .sort((left, right) => left.localeCompare(right));
const captures = existsSync(join(archive, "capture.json"))
  ? loadFreshCorpus(archive)
  : files.map((file) => {
      const snapshotBytes = readFileSync(join(archive, file.replace(".labels.json", ".json")));
      const labelBytes = readFileSync(join(archive, file));
      return {
        page: file.replace(".labels.json", ""),
        snapshotDigest: digest(snapshotBytes),
        labelDigest: digest(labelBytes),
        snapshot: JSON.parse(snapshotBytes.toString()) as Snapshot,
        labels: JSON.parse(labelBytes.toString()) as Label[],
      };
    });
const tasks = captures.flatMap(({ page, snapshot, snapshotDigest, labels }) =>
  labels
    .filter((label) => label.available)
    .map((label) => ({ page, snapshot, snapshotDigest, label })),
);
if (!tasks.length || tasks.length * rounds * arms.length > 600)
  throw new Error("Invalid trial count");
if (new Set(tasks.map(({ label }) => label.name)).size !== tasks.length) {
  throw new Error("Duplicate task IDs in capture archive");
}

mkdirSync(output);
const results = join(output, "results.jsonl");
writeFileSync(
  join(output, "manifest.json"),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      routingSource: Object.fromEntries(
        ["fresh.ts", "gateway.ts", "joint.ts", "ordinary.ts", "replay.ts"].map((file) => [
          file,
          digest(readFileSync(new URL(file, import.meta.url))),
        ]),
      ),
      models: models.map(({ model }) => model),
      arms: arms.map(({ model, arm }) => ({ model, arm })),
      rounds,
      captures: captures.map(({ page, snapshotDigest, labelDigest, labels }) => ({
        page,
        snapshotDigest,
        labelDigest,
        tasks: labels.filter(({ available }) => available).map(({ name }) => name),
      })),
    },
    null,
    2,
  ) + "\n",
);

type Receipt = { status?: number; ms: number; bytes?: number };
const receipts = new AsyncLocalStorage<Receipt[]>();
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const isGateway = input === `${GATEWAY_ROOT}/v1/decisions`;
  const body = typeof init?.body === "string" ? init.body : undefined;
  if (isGateway && body === undefined) throw new Error("Expected a JSON Gateway request");
  const wireBody = isGateway ? encodeGatewayDecision(body!) : body;
  const started = performance.now();
  let status: number | undefined;
  try {
    const response = await fetchOriginal(input, {
      ...init,
      redirect: "error",
      ...(isGateway ? { body: wireBody } : {}),
    });
    status = response.status;
    return isGateway ? await decodeGatewayDecision(response) : response;
  } finally {
    const log = receipts.getStore();
    log?.push({
      status,
      ms: performance.now() - started,
      bytes: wireBody === undefined ? undefined : Buffer.byteLength(wireBody),
    });
  }
};

let nextIndex = 0;
try {
  await Promise.all(
    Array.from({ length: 2 }, async () => {
      while (nextIndex < tasks.length * rounds) {
        const index = nextIndex++;
        const round = Math.floor(index / tasks.length);
        const { label, page, snapshot, snapshotDigest } = tasks[index % tasks.length]!;
        for (let offset = 0; offset < arms.length; offset++) {
          const { arm, model, config, run } = arms[(index + offset) % arms.length]!;
          const requests: Receipt[] = [];
          const usage: Array<
            Parameters<NonNullable<DecisionModelConfig["recordDecisionUsage"]>>[0]
          > = [];
          const started = performance.now();
          const outcome = await receipts
            .run(requests, () =>
              run(
                {
                  ...config,
                  signal: AbortSignal.timeout(20_000),
                  recordDecisionUsage: (item) => usage.push(item),
                },
                snapshot,
                label.instruction,
              ),
            )
            .catch((error: unknown) => ({
              kind: "error" as const,
              reason: error instanceof Error ? error.name : "unknown",
            }));
          const ms = performance.now() - started;
          appendFileSync(
            results,
            JSON.stringify({
              page,
              snapshotDigest,
              task: label.name,
              workload: label.workload,
              round,
              arm,
              model,
              ms,
              kind: outcome.kind,
              reason: outcome.kind === "done" ? undefined : outcome.reason,
              grade:
                outcome.kind === "done"
                  ? "check" in label
                    ? label.check(outcome.actions)
                    : grade(outcome.actions, label, snapshot as Snapshot)
                  : undefined,
              requests,
              usage,
            }) + "\n",
          );
        }
      }
    }),
  );
} finally {
  globalThis.fetch = fetchOriginal;
}
