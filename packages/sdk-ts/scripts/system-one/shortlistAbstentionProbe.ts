import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { z } from "zod/v4";
import { trace } from "@opentelemetry/api";
import { StagehandLogger } from "../../../extension/logger.js";
import * as extractService from "../../../extension/services/extractService.js";
import { decide } from "../../../extension/services/decisions/client.js";
import { CORPUS_DIR, corpusTasks } from "./capture.js";
import { groupLabels } from "./groupLabels.js";
import { listGroupProbe, listGroupRanks } from "./mapCopy.js";
import { decisionConfigs, loadFrozen } from "./replay.js";

const retryOnlyLabels = {
  hold7_kubernetes_pod_phases: { first: "0-7033", last: "0-7049", rows: 5 },
  hold7_wasm_number_types: { first: "0-2409", last: "0-2415", rows: 4 },
};

const model = "pplx-decider-v1.3";
const rounds = 2;
const extraction = process.env.GROUP_PROBE_EXTRACT === "1";
const sourceCoverage = process.env.GROUP_PROBE_SOURCE_COVERAGE === "1";
const only = process.env.GROUP_PROBE_TASKS?.split(",");
const logger = new StagehandLogger(
  { tracer: trace.getTracer("abstention-probe") },
  () => {},
  undefined,
  "off",
);
const id = randomUUID();
const archive = new URL(`runs/group-probes/${id}/`, CORPUS_DIR);
mkdirSync(archive, { recursive: true });

const cases = Object.entries({ ...retryOnlyLabels, ...groupLabels }).flatMap(([name, label]) => {
  if (only && !only.includes(name)) return [];
  const task = corpusTasks.find((candidate) => candidate.name === name);
  if (!task) throw new Error(`Missing task: ${name}`);
  const frozen = loadFrozen(name);
  const input = { ...frozen, schema: z.toJSONSchema(task.schema), instruction: task.instruction };
  const [rank] = listGroupRanks(input);
  if (!rank) throw new Error(`Missing list: ${name}`);
  const covering = rank.groups
    .filter(
      ({ records }) =>
        records.length >= label.rows &&
        records.includes(label.first) &&
        records.includes(label.last),
    )
    .map(({ id }) => id);
  const supplementary = rank.schema.slice(0, 4).filter((id) => !rank.baseline.includes(id));
  const retryOnly = Object.hasOwn(retryOnlyLabels, name);
  if (
    retryOnly &&
    (rank.baseline.some((id) => covering.includes(id)) ||
      !supplementary.some((id) => covering.includes(id)))
  )
    throw new Error(`Retry-only control no longer matches its label: ${name}`);
  return (retryOnly ? (["missing", "retry-only"] as const) : (["missing"] as const)).map(
    (variant) => {
      const omit = variant === "missing" ? covering : [];
      const [baseline] = listGroupProbe(input, { omit });
      const [retry] = listGroupProbe(input, { omit, shortlist: "supplementary" });
      return {
        name,
        variant,
        covering,
        omit,
        label,
        instruction: task.instruction,
        snapshotHash: createHash("sha256").update(JSON.stringify(frozen)).digest("hex"),
        baseline,
        retry,
      };
    },
  );
});

writeFileSync(
  new URL("manifest.json", archive),
  JSON.stringify(
    {
      id,
      model,
      rounds,
      extraction,
      sourceCoverage,
      revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      cases,
    },
    null,
    2,
  ),
);
process.stderr.write(JSON.stringify({ id, model, cases: cases.length, rounds }) + "\n");

async function select(
  instruction: string,
  questions: NonNullable<(typeof cases)[number]["baseline"]>,
) {
  const result = await decide(
    { ...decisionConfigs.decider, model },
    { task: instruction },
    questions,
  );
  const answer = result.answers.group;
  if (answer?.type !== "choice") throw new Error("Missing group choice");
  const predicates = Object.entries(result.answers).flatMap(([id, value]) =>
    value.type === "noul" ? [{ id: id.slice(3), yes: value.noul }] : [],
  );
  const best = predicates.toSorted((a, b) => b.yes - a.yes)[0];
  const status =
    answer.choice === "none"
      ? "abstain"
      : best?.id === answer.choice && best.yes >= 0.5
        ? "accept"
        : "disagree";
  return {
    status,
    choice: answer.choice,
    confidence: answer.confidence,
    best,
    usage: result.usage,
    ms: result.durationMs,
  };
}

for (let round = 0; round < rounds; round++) {
  for (const test of cases) {
    const { name, variant, covering, instruction, baseline, retry, omit } = test;
    let outcome;
    try {
      const first = baseline ? await select(instruction, baseline) : undefined;
      const second =
        first?.status === "abstain" && retry ? await select(instruction, retry) : undefined;
      const selected = second ?? first;
      const accepted = selected?.status === "accept";
      const wrongAccept =
        accepted && (variant === "missing" || !covering.includes(selected.choice));
      outcome = {
        first,
        second,
        wrongAccept,
        passed: variant === "missing" ? !wrongAccept : Boolean(second && accepted && !wrongAccept),
      };
      if (extraction && accepted) {
        const task = corpusTasks.find((task) => task.name === name)!;
        const frozen = loadFrozen(name);
        try {
          const result = await extractService.extract({
            params: {
              pageId: "replay",
              instruction,
              schema: z.json().parse(z.toJSONSchema(task.schema)),
              options: { cache: false, timeout: 30_000 },
            },
            page: {
              captureSnapshot: async () => ({
                combinedTree: frozen.tree,
                combinedXpathMap: frozen.xpathMap,
                combinedUrlMap: frozen.urlMap,
              }),
              screenshot: async () => new Uint8Array(),
            },
            model: { source: "client" },
            clientLLMGenerate: async () => {
              throw new Error("Unexpected fallback LLM request");
            },
            logger,
            decisions: { ...decisionConfigs.decider, model, extract: "map", llmFallback: false },
            groupExperiment: { retryGroupProbe: { omit, sourceCoverage } },
          });
          const failure = task.grade(result.data);
          Object.assign(outcome, {
            direct: true,
            extractionPassed: failure === undefined,
            failure,
            data: result.data,
          });
        } catch (error) {
          Object.assign(outcome, {
            direct: false,
            extractionError: error instanceof Error ? error.message.slice(0, 180) : String(error),
          });
        }
      }
    } catch (error) {
      outcome = { error: error instanceof Error ? error.message.slice(0, 180) : String(error) };
    }
    const line = JSON.stringify({ name, variant, round, ...outcome }) + "\n";
    appendFileSync(new URL("results.jsonl", archive), line);
    process.stdout.write(line);
  }
}
