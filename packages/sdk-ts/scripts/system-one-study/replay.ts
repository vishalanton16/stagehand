import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PERPLEXITY_DEFAULT_MODEL } from "../../../extension/services/decisions/client.js";
import { trimTrailingTextNode } from "../../../extension/utils.js";
import { hybrid, literal, runtime, type ReplayArm } from "./arms.js";
import manifest from "./manifest.json" with { type: "json" };

const [dir, ...armSpecs] = process.argv.slice(2);
if (!dir || !armSpecs.length) {
  throw new Error("Usage: replay.ts <capture-dir> <literal|runtime|hybrid|./variant.ts> [...]");
}
const live = process.env.STUDY_LIVE === "1";
const apiKey = process.env.PERPLEXITY_API_KEY;
if (live && !apiKey) throw new Error("STUDY_LIVE=1 requires PERPLEXITY_API_KEY");
const model = process.env.STUDY_MODEL ?? PERPLEXITY_DEFAULT_MODEL;
const rounds = Number(process.env.STUDY_ROUNDS ?? 1);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 2) {
  throw new Error("STUDY_ROUNDS must be 1 or 2");
}

const arms = new Map<string, ReplayArm>();
const builtins = new Map(Object.entries({ literal, runtime, hybrid }));
for (const name of armSpecs) {
  if (arms.has(name)) throw new Error("Duplicate arm: " + name);
  const arm = builtins.get(name) ?? (await import(pathToFileURL(resolve(name)).href)).default;
  if (typeof arm !== "function") throw new Error("Arm needs a default ReplayArm export: " + name);
  arms.set(name, arm);
}

type Snapshot = Parameters<ReplayArm>[0]["snapshot"];
type Target = { node: string; method: string; arguments?: string[] };
type StudyCase = {
  id: string;
  site: string;
  instruction: string | null;
  match: string;
  targets: Target[];
};

const cases: readonly StudyCase[] = manifest.cases;
const selectedIds = process.env.STUDY_CASES?.split(",");
if (
  selectedIds &&
  (new Set(selectedIds).size !== selectedIds.length ||
    selectedIds.some((id) => !cases.some((studyCase) => studyCase.id === id)))
) {
  throw new Error("STUDY_CASES must list distinct case IDs from the manifest");
}
const selectedCases = selectedIds
  ? cases.filter((studyCase) => selectedIds.includes(studyCase.id))
  : cases;
const captures = new Map(
  manifest.captures.map(({ site, sha256 }) => {
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Invalid digest for " + site);
    const bytes = readFileSync(join(dir, sha256 + ".json"));
    if (createHash("sha256").update(bytes).digest("hex") !== sha256) {
      throw new Error("Digest mismatch for " + site);
    }
    return [site, { sha256, json: bytes.toString("utf8") }];
  }),
);
const jobs = selectedCases.map((studyCase) => {
  const capture = captures.get(studyCase.site);
  if (!capture) throw new Error("Missing capture for " + studyCase.id);
  const snapshot: Snapshot = JSON.parse(capture.json);
  const expected = studyCase.targets.map((target) => {
    const path = trimTrailingTextNode(snapshot.xpathMap[target.node]);
    if (!path || !snapshot.facts[target.node]?.visible) {
      throw new Error("Audited node lacks visible snapshot evidence for " + studyCase.id);
    }
    return actionKey("xpath=" + path, target.method, target.arguments ?? []);
  });
  if (
    (studyCase.match !== "exact" && studyCase.match !== "one-of") ||
    new Set(expected).size !== expected.length ||
    (studyCase.match === "one-of" && expected.length < 2)
  ) {
    throw new Error("Invalid expected action set for " + studyCase.id);
  }
  return { ...studyCase, ...capture, expected };
});

function actionKey(selector: string, method: string | undefined, args: string[] | undefined) {
  return JSON.stringify([selector, method, args ?? []]);
}

// Count HTTP attempts, including retries. Only the configured provider can receive evidence.
const realFetch = globalThis.fetch;
const runBudget = 80;
const caseBudget = 8;
const timeoutMs = 24_000;
let totalRequests = 0;
process.stdout.write(
  JSON.stringify({
    kind: "run",
    captureRevision: manifest.captureRevision,
    labelsSha256: createHash("sha256").update(JSON.stringify(cases)).digest("hex"),
    arms: armSpecs,
    rounds,
    cases: selectedCases.map((studyCase) => studyCase.id),
    live,
    model: live ? model : null,
    runBudget,
    caseBudget,
    timeoutMs,
  }) + "\n",
);
for (let round = 0; round < rounds; round++) {
  for (const [index, job] of jobs.entries()) {
    const orderedArms = [...arms];
    if ((round + index) % 2) orderedArms.reverse();

    for (const [armName, arm] of orderedArms) {
      const httpStatus: number[] = [];
      let requests = 0;
      let blocked = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let errorName: string | undefined;
      const signal = AbortSignal.timeout(timeoutMs);
      globalThis.fetch = async (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (
          !live ||
          url !== "https://api.perplexity.ai/v1/decisions" ||
          requests >= caseBudget ||
          totalRequests >= runBudget
        ) {
          blocked++;
          throw new Error("Replay fetch blocked");
        }
        requests++;
        totalRequests++;
        const response = await realFetch(input, {
          ...init,
          redirect: "error",
          signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
        });
        httpStatus.push(response.status);
        return response;
      };
      const started = performance.now();
      let outcome;
      try {
        outcome = await arm({
          snapshot: JSON.parse(job.json),
          instruction: job.instruction ?? undefined,
          config: {
            provider: "perplexity",
            apiKey: live ? apiKey! : `offline-${job.id}-${armName}-${round}`,
            model,
            signal,
            recordDecisionUsage: (usage) => {
              inputTokens += usage.inputTokens;
              outputTokens += usage.outputTokens;
            },
          },
        });
      } catch {
        errorName = signal.aborted ? "timeout" : blocked ? "fetch_blocked" : "arm_error";
      } finally {
        globalThis.fetch = realFetch;
      }

      const actual =
        outcome?.kind === "done"
          ? outcome.actions.map((action) =>
              actionKey(action.selector, action.method, action.arguments),
            )
          : undefined;
      const matched = actual?.filter((key) => job.expected.includes(key)).length;
      const expectedCount = job.match === "one-of" ? 1 : job.expected.length;
      const passed = actual
        ? actual.length === expectedCount &&
          matched === expectedCount &&
          new Set(actual).size === actual.length
        : null;
      const reason = outcome?.kind === "fallback" ? outcome.reason : errorName;
      process.stdout.write(
        JSON.stringify({
          kind: "result",
          case: job.id,
          arm: armName,
          round: round + 1,
          sha256: job.sha256,
          outcome: outcome?.kind ?? "error",
          reason: reason && /^[a-z_]+(?::\d+)?$/.test(reason) ? reason : reason ? "other" : null,
          passed,
          expectedCount,
          returnedCount: actual?.length ?? null,
          matchedCount: matched ?? null,
          ms: Math.round(performance.now() - started),
          requests,
          blocked,
          httpStatus,
          inputTokens: live ? inputTokens : null,
          outputTokens: live ? outputTokens : null,
        }) + "\n",
      );
    }
  }
}
