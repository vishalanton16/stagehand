import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  buildScalarReaderInput,
  mapCopyExtract,
  numberCandidates,
  type JsonSchema,
  type TraceEntry,
} from "../../../extension/services/decisions/mapCopy.js";
import type { DecisionsConfig } from "../../../extension/services/decisions/config.js";
import { scalarReader } from "../../../extension/services/decisions/scalarReader.js";
import { runWithProgress } from "../../../extension/understudy/progress.js";
import { CORPUS_DIR } from "./capture.js";

type GoldField = {
  description: string;
  value: string | number | null;
  spans?: string[];
  optional?: boolean;
  type?: "number" | "string";
  sourceContains?: string;
};

const cases: {
  snapshot: string;
  instruction: string;
  fields: Record<string, GoldField>;
}[] = [
  {
    snapshot: "hold6_nasa_mars",
    instruction:
      "Extract the duration of one Martian day in hours and of one Martian year in Earth days.",
    fields: {
      dayHours: { description: "Martian day duration in hours", value: 24.6, spans: ["24.6"] },
      yearEarthDays: {
        description: "Martian year duration in Earth days",
        value: 687,
        spans: ["687"],
      },
    },
  },
  {
    snapshot: "hold6_economics_school",
    instruction:
      "Extract the introductory textbook title and its edition number only if explicitly labeled as an edition. Omit the edition if absent.",
    fields: {
      title: { description: "Introductory textbook title", value: "The Economy 2.0" },
      edition: {
        description: "Explicit edition number",
        value: null,
        type: "number",
        optional: true,
      },
    },
  },
  {
    snapshot: "pypi_requests",
    instruction:
      "Extract the minimum supported Python version for Requests from the package's Requires metadata. Copy only the version, without the comparison operator.",
    fields: {
      python: {
        description: "Minimum Python version string in Requires metadata",
        value: "3.10",
        sourceContains: "Requires:",
      },
    },
  },
  {
    snapshot: "eiffel_infobox",
    instruction:
      "Extract the full dates the Eiffel Tower's construction started and was completed from the infobox, excluding footnotes and elapsed years.",
    fields: {
      started: {
        description: "Full construction start date as printed",
        value: "28 January 1887",
        sourceContains: "Construction started:",
      },
      completed: {
        description: "Full completion date as printed",
        value: "31 March 1889",
        sourceContains: "Completed:",
      },
    },
  },
  {
    snapshot: "hold5_sqlite_limits",
    instruction:
      "Extract the default and compile-time maximum for SQLITE_MAX_COLUMN. Both values are explicitly stated.",
    fields: {
      defaultColumns: {
        description: "Default SQLITE_MAX_COLUMN setting",
        value: 2000,
        spans: ["2000"],
      },
      maximumColumns: {
        description: "Compile-time maximum SQLITE_MAX_COLUMN setting",
        value: 32767,
        spans: ["32767"],
      },
    },
  },
  {
    snapshot: "gutenberg_pride",
    instruction:
      "Extract the Project Gutenberg eBook number and the release date printed in the metadata table.",
    fields: {
      ebookNumber: { description: "Project Gutenberg eBook number", value: 1342, spans: ["1342"] },
      releaseDate: { description: "Release Date as printed", value: "Jun 1, 1998" },
    },
  },
  {
    snapshot: "hold5_w3c_absent",
    instruction:
      "Extract the conformance level for Success Criterion 2.3.1 and its publication date only if stated in this section. Omit the date if absent.",
    fields: {
      level: {
        description: "Conformance level letter as printed",
        value: "A",
        sourceContains: "(Level A)",
      },
      date: {
        description: "Publication date explicitly stated in this section",
        value: null,
        optional: true,
      },
    },
  },
  {
    snapshot: "linear_pricing",
    instruction:
      "Extract the displayed per-user monthly USD prices for the Free, Basic, and Business plans. Use the displayed prices with annual billing selected.",
    fields: {
      free: { description: "Displayed Free plan price in USD", value: 0, spans: ["0", "$0"] },
      basic: { description: "Displayed Basic plan price in USD", value: 10, spans: ["10", "$10"] },
      business: {
        description: "Displayed Business plan price in USD",
        value: 16,
        spans: ["16", "$16"],
      },
    },
  },
  {
    snapshot: "hold5_explicit_zero",
    instruction:
      "Extract the unresolved defect count and the total defect count if explicitly printed. Do not calculate the total.",
    fields: {
      unresolved: { description: "Unresolved defect count", value: 0, spans: ["0"] },
      total: {
        description: "Explicitly stated total defect count",
        value: null,
        type: "number",
        optional: true,
      },
    },
  },
];

const decider = "pplx-decider-v1.3";
const flash = "pplx-decider-flash-v1.3";
const availableArms = [
  "copy",
  "locate",
  "locate-flash",
  "clairic-text",
  "clairic-typed",
  "check-only",
] as const;
type Arm = (typeof availableArms)[number];
const arms = process.env.SCALAR_ARMS
  ? process.env.SCALAR_ARMS.split(",").map((name) => {
      const arm = availableArms.find((entry) => entry === name);
      if (!arm) throw new Error(`Unknown scalar arm ${name}`);
      return arm;
    })
  : [...availableArms];
type Span = { start: number; end: number; text: string; score?: number };
type Answer =
  | { spans: Span[] }
  | { value: string | number | null; span?: [number, number]; p_null?: number };
type Usage = {
  input_tokens: number;
  output_tokens: number;
  state_tokens?: number;
  passes?: number;
};
type Snapshot = { tree: string; urlMap: Record<string, string>; url?: string };

const packs = cases.map((task) => {
  const source = readFileSync(new URL(task.snapshot + ".json", CORPUS_DIR));
  const snapshot = JSON.parse(source.toString()) as Snapshot;
  const schema: JsonSchema = {
    type: "object",
    properties: Object.fromEntries(
      Object.entries(task.fields).map(([key, field]) => [
        key,
        {
          description: field.description,
          type: field.type ?? (typeof field.value === "number" ? "number" : "string"),
        },
      ]),
    ),
    required: Object.keys(task.fields).filter((key) => !task.fields[key]!.optional),
  };
  const evidence = buildScalarReaderInput(schema, snapshot.tree, snapshot.urlMap, task.instruction);
  if (!evidence.sheet || evidence.fields.length !== Object.keys(task.fields).length)
    throw new Error(`Incomplete evidence pack for ${task.snapshot}`);
  return {
    task,
    schema,
    snapshot,
    evidence,
    snapshotHash: createHash("sha256").update(source).digest("hex"),
  };
});

function acceptedSpans(field: GoldField): string[] {
  return field.spans ?? (typeof field.value === "string" ? [field.value] : []);
}

const dir = new URL(`runs/real-scalar-probes/${randomUUID()}/`, CORPUS_DIR);
const rounds = Number(process.env.SCALAR_ROUNDS ?? 2);
if (!Number.isInteger(rounds) || rounds <= 0)
  throw new Error("SCALAR_ROUNDS must be a positive integer");
mkdirSync(dir, { recursive: true });
writeFileSync(
  new URL("manifest.json", dir),
  JSON.stringify(
    {
      revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      arms,
      rounds,
      models: { decider, flash, clairic: "@cf/cloudflare/clairic" },
      sourceHash: createHash("sha256")
        .update(readFileSync(new URL(import.meta.url)))
        .digest("hex"),
      packs: packs.map(({ task, schema, evidence, snapshotHash, snapshot }) => ({
        task,
        schema,
        evidence,
        snapshotHash,
        url: snapshot.url,
        evidenceContains: Object.fromEntries(
          Object.entries(task.fields).map(([key, field]) => [
            key,
            field.value === null
              ? null
              : acceptedSpans(field).some((span) => evidence.sheet.includes(span)),
          ]),
        ),
      })),
    },
    null,
    2,
  ),
);
process.stderr.write(dir.pathname + "\n");

if (process.env.SCALAR_PREPARE_ONLY !== "1") {
  const credentials = ["PERPLEXITY_API_KEY"];
  if (arms.some((arm) => arm.startsWith("clairic"))) {
    credentials.push("CLOUDFLARE_AUTH_TOKEN", "CLOUDFLARE_ACCOUNT_ID");
  }
  for (const key of credentials) {
    if (!process.env[key]) throw new Error(`Missing ${key}`);
  }
  let failed = false;
  for (let round = 0; round < rounds; round++) {
    for (const [index, pack] of packs.entries()) {
      const offset = (round + index) % arms.length;
      for (const arm of [...arms.slice(offset), ...arms.slice(0, offset)]) {
        const start = performance.now();
        let result;
        try {
          result =
            arm === "copy" || arm === "check-only"
              ? await copy(pack, arm === "check-only")
              : await read(pack, arm);
        } catch (cause) {
          failed = true;
          result = { error: cause instanceof Error ? cause.message.slice(0, 180) : String(cause) };
        }
        const record =
          JSON.stringify({
            round,
            arm,
            task: pack.task.snapshot,
            ms: Math.round(performance.now() - start),
            ...result,
          }) + "\n";
        appendFileSync(new URL("results.jsonl", dir), record);
        process.stdout.write(record);
      }
    }
  }
  if (failed) process.exitCode = 1;
}

type Pack = (typeof packs)[number];

async function copy(pack: Pack, checkOnly: boolean) {
  const { task, schema, snapshot } = pack;
  const usage = { input_tokens: 0, output_tokens: 0, calls: 0 };
  const trace: TraceEntry[] = [];
  let data: Record<string, unknown> = {};
  let abstained: string | undefined;
  try {
    const outcome = await runWithProgress(
      { name: "scalar replay", timeout: 25_000 },
      (progress) => {
        const config: DecisionsConfig = {
          provider: "perplexity",
          apiKey: process.env.PERPLEXITY_API_KEY!,
          model: decider,
          signal: progress.signal,
          recordDecisionUsage: (entry) => {
            usage.input_tokens += entry.inputTokens;
            usage.output_tokens += entry.outputTokens;
            usage.calls++;
          },
        };
        return mapCopyExtract(config, {
          schema,
          instruction: task.instruction,
          tree: snapshot.tree,
          urlMap: snapshot.urlMap,
          trace,
          reader: checkOnly ? scalarReader(config, progress) : undefined,
          readerChecks: checkOnly,
        });
      },
    );
    data = outcome.data;
    if (outcome.verdict?.problems.length) abstained = outcome.verdict.problems.join(",");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("unresolved:")) throw error;
    abstained = error.message;
  }
  return {
    usage,
    data,
    trace,
    abstained,
    fields: Object.fromEntries(
      Object.entries(task.fields).map(([key, field]) => [key, grade(field, data[key] ?? null)]),
    ),
  };
}

async function read(pack: Pack, arm: Exclude<Arm, "copy" | "check-only">) {
  const { task, evidence } = pack;
  const cloudflare = arm.startsWith("clairic");
  const url = cloudflare
    ? `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID!)}/ai/run/@cf/cloudflare/clairic`
    : "https://api.perplexity.ai/v1/decisions";
  const fields = Object.fromEntries(
    evidence.fields.map((field) => [
      field.name,
      {
        type: cloudflare
          ? arm === "clairic-typed" && field.type === "number"
            ? "number"
            : "text"
          : "locate",
        instructions: `${field.instructions}\nCopy only the value as printed. If the requested fact is absent, return no value. Do not calculate it.`,
      },
    ]),
  );
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cloudflare ? process.env.CLOUDFLARE_AUTH_TOKEN : process.env.PERPLEXITY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: cloudflare ? "clairic" : arm === "locate-flash" ? flash : decider,
      state: evidence.sheet,
      ...(cloudflare ? { fields } : { questions: fields }),
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  const payload = (cloudflare ? body.result : body) as {
    answers: Record<string, Answer>;
    usage: Usage;
    truncated?: boolean;
  };
  const codePoints = Array.from(evidence.sheet);
  const scored = Object.fromEntries(
    Object.entries(task.fields).map(([key, field]) => {
      const answer = payload.answers[key];
      if (!answer) throw new Error(`Missing answer for ${key}`);
      const best =
        "spans" in answer ? answer.spans.toSorted((a, b) => b.score! - a.score!)[0] : undefined;
      const raw = "spans" in answer ? (best?.text ?? null) : answer.value;
      const span =
        "spans" in answer
          ? best
          : answer.span &&
            typeof raw === "string" && {
              start: answer.span[0],
              end: answer.span[1],
              text: raw,
            };
      const offsetValid = span
        ? Number.isInteger(span.start) &&
          Number.isInteger(span.end) &&
          span.start >= 0 &&
          span.start < span.end &&
          span.end <= codePoints.length &&
          codePoints.slice(span.start, span.end).join("") === span.text
        : null;
      const sourceLine =
        offsetValid && span
          ? codePoints.slice(0, span.start).join("").split("\n").at(-1)! +
            span.text +
            codePoints.slice(span.end).join("").split("\n")[0]
          : undefined;
      return [
        key,
        {
          ...grade(field, raw),
          offsetValid,
          sourceLine,
          exactSpan:
            field.value === null || (arm === "clairic-typed" && typeof field.value === "number")
              ? null
              : !!span &&
                !!offsetValid &&
                acceptedSpans(field).includes(span.text) &&
                (!field.sourceContains || !!sourceLine?.includes(field.sourceContains)),
        },
      ];
    }),
  );
  return {
    fields: scored,
    answers: payload.answers,
    usage: payload.usage,
    truncated: payload.truncated,
  };
}

function grade(field: GoldField, raw: unknown) {
  let value = raw;
  if (typeof field.value === "number" && typeof raw === "string") {
    const numbers = numberCandidates(raw);
    value = numbers.length === 1 ? numbers[0]!.value : undefined;
  }
  return {
    raw,
    value: value ?? null,
    presence: (field.value === null) === (raw === null),
    correct: field.value === value,
  };
}
