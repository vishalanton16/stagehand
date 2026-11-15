import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { z } from "zod/v4";
import { decide, type DecisionQuestion } from "../../../extension/services/decisions/client.js";
import { CORPUS_DIR, corpusTasks } from "./capture.js";
import { groupLabels } from "./groupLabels.js";
import { baselineModule } from "./baseline.js";
const { listGroupProbe, listGroupRanks } = await baselineModule("services/decisions/mapCopy");
import { decisionConfigs, loadFrozen } from "./replay.js";

const configs = {
  jev: { ...decisionConfigs.jev, model: "jev-1.14.0" },
  decider: { ...decisionConfigs.decider, model: "pplx-decider-v1.3" },
  flash: { ...decisionConfigs.flash, model: "pplx-decider-flash-v1.3" },
  clef: { ...decisionConfigs.clef, model: "clef" },
  "clef-flash": decisionConfigs.clef,
};
type Provider = keyof typeof configs;
type Answer = {
  name: string;
  type: string;
  choice?: string;
  confidence?: number;
  probability?: number;
};

async function gatewayDecisions(input: string, questions: Record<string, DecisionQuestion>) {
  const response = await fetch(
    `${process.env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1"}/decisions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-6-luna-decisions",
        input,
        questions: Object.entries(questions).map(([name, question]) =>
          question.type === "choice"
            ? {
                name,
                type: "choice",
                instructions: question.instructions,
                choices: Object.entries(question.criteria).map(([value, description]) => ({
                  value,
                  description,
                })),
              }
            : { name, type: "predicate", instructions: question.instructions },
        ),
      }),
      signal: AbortSignal.timeout(25000),
    },
  );
  if (!response.ok) throw new Error(`AI Gateway returned HTTP ${response.status}`);
  const data = (await response.json()) as {
    model: string;
    answers: Answer[];
    usage: {
      input_tokens: number;
      output_tokens: number;
      input_tokens_details?: Record<string, number>;
    };
  };
  return {
    model: data.model,
    usage: data.usage,
    choice: data.answers.find(({ name }) => name === "group"),
    predicates: data.answers
      .filter(({ type }) => type === "predicate")
      .map(({ name, probability }) => [name.slice(3), probability] as const),
  };
}

async function nativeDecisions(
  provider: Provider,
  input: string,
  questions: Record<string, DecisionQuestion>,
) {
  const result = await decide(configs[provider], { task: input }, questions);
  const choice = result.answers.group;
  return {
    model: result.model,
    usage: result.usage,
    choice: choice?.type === "choice" ? choice : undefined,
    predicates: Object.entries(result.answers).flatMap(([name, answer]) =>
      answer.type === "noul" ? [[name.slice(3), answer.noul] as const] : [],
    ),
  };
}

const requested = process.env.GROUP_PROBE_PROVIDERS?.split(",") ?? [
  ...Object.keys(configs),
  "openai",
];
for (const provider of requested) {
  if (provider !== "openai" && !Object.hasOwn(configs, provider))
    throw new Error(`Unknown provider: ${provider}`);
}

const id = randomUUID();
const archive = new URL(`runs/group-probes/${id}/`, CORPUS_DIR);
mkdirSync(archive, { recursive: true });
const manifest = {
  id,
  revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  models: Object.fromEntries(
    requested.map((provider) => [
      provider,
      provider === "openai" ? "openai/gpt-6-luna-decisions" : configs[provider as Provider].model,
    ]),
  ),
};
writeFileSync(new URL("manifest.json", archive), JSON.stringify(manifest, null, 2));
process.stderr.write(JSON.stringify(manifest) + "\n");

const jobs = [];
for (const [name, label] of Object.entries(groupLabels)) {
  if (!label.oracle) continue;
  const task = corpusTasks.find((candidate) => candidate.name === name);
  if (!task) throw new Error(`Missing task: ${name}`);
  const frozen = loadFrozen(name);
  const input = { ...frozen, schema: z.toJSONSchema(task.schema), instruction: task.instruction };
  const [rank] = listGroupRanks(input);
  const covering = rank!.groups
    .filter(
      ({ records }) =>
        records.length >= label.rows &&
        records.includes(label.first) &&
        records.includes(label.last),
    )
    .map(({ id }) => id);
  if (!rank!.baseline.includes(label.oracle) || !covering.includes(label.oracle))
    throw new Error(`Oracle missing from shortlist: ${name}`);
  for (const variant of ["dual", "choice", "reverse", "rich", "missing"] as const) {
    const [pack] = listGroupProbe(input, {
      omit: variant === "missing" ? covering : [],
      reverse: variant === "reverse",
      richer: variant === "rich",
    });
    if (!pack) throw new Error(`Empty option pack for ${name}: ${variant}`);
    const questions = variant === "dual" ? pack : { group: pack.group! };
    for (const provider of requested) {
      jobs.push({
        task: name,
        variant,
        provider,
        input: task.instruction,
        questions,
        covering,
        expected: variant === "missing" ? "none" : label.oracle,
        snapshotHash: createHash("sha256").update(JSON.stringify(frozen)).digest("hex"),
      });
    }
  }
}
writeFileSync(new URL("requests.json", archive), JSON.stringify(jobs));

let next = 0;
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (next < jobs.length) {
      const { input, questions, ...job } = jobs[next++]!;
      const start = performance.now();
      let outcome;
      try {
        outcome =
          job.provider === "openai"
            ? await gatewayDecisions(input, questions)
            : await nativeDecisions(job.provider as Provider, input, questions);
      } catch (error) {
        outcome = { error: error instanceof Error ? error.message.slice(0, 180) : String(error) };
      }
      const line =
        JSON.stringify({ ...job, ...outcome, ms: Math.round(performance.now() - start) }) + "\n";
      appendFileSync(new URL("results.jsonl", archive), line);
      process.stdout.write(line);
    }
  }),
);
