import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod/v4";
import { mapCopyExtract, type JsonSchema } from "../../../extension/services/decisions/mapCopy.js";
import type { DecisionsConfig } from "../../../extension/services/decisions/pipeline.js";
import { scalarReader } from "../../../extension/services/decisions/scalarReader.js";
import type { HtmlTable, TableField } from "../../../extension/services/decisions/tableBinding.js";
import {
  extractTableScalar,
  prepareTableScalarFromTables,
} from "../../../extension/services/decisions/tableScalar.js";
import { runWithProgress } from "../../../extension/understudy/progress.js";

type Field = TableField & { pattern?: string };
type GroundTruth = Record<string, string | number> | null;
type Case = {
  name: string;
  page?: string;
  control?: boolean;
  instruction: string;
  fields: Field[];
  expected: GroundTruth;
};
const cases: Case[] = [
  {
    name: "binding_nist_regression",
    control: true,
    instruction:
      "From the metric prefix table, copy the case-sensitive symbols for ronna and quecto.",
    fields: [
      { name: "ronna", type: "string", description: "Symbol column for the ronna prefix" },
      { name: "quecto", type: "string", description: "Symbol column for the quecto prefix" },
    ],
    expected: { ronna: "R", quecto: "q" },
  },
  {
    name: "binding_postgres_datetime",
    instruction:
      "From the date/time type table, extract the storage sizes in bytes for date and interval.",
    fields: [
      {
        name: "dateBytes",
        type: "number",
        description: "Storage size for the date type, in bytes",
      },
      {
        name: "intervalBytes",
        type: "number",
        description: "Storage size for the interval type, in bytes",
      },
    ],
    expected: { dateBytes: 4, intervalBytes: 16 },
  },
  {
    name: "binding_python_struct",
    instruction:
      "From the format characters table, extract the standard sizes for signed short and unsigned long long.",
    fields: [
      {
        name: "shortBytes",
        type: "number",
        description: "Standard size for the C type short, format h",
      },
      {
        name: "longLongBytes",
        type: "number",
        description: "Standard size for the C type unsigned long long, format Q",
      },
    ],
    expected: { shortBytes: 2, longLongBytes: 8 },
  },
  {
    name: "binding_mdn_typed_arrays",
    instruction:
      "From the Typed array views table, extract the size in bytes for Float16Array and BigInt64Array.",
    fields: [
      { name: "float16Bytes", type: "number", description: "Size in bytes for Float16Array" },
      { name: "bigInt64Bytes", type: "number", description: "Size in bytes for BigInt64Array" },
    ],
    expected: { float16Bytes: 2, bigInt64Bytes: 8 },
  },
  {
    name: "binding_css_colors",
    instruction:
      "From the extended color keywords table, copy the Hex rgb values for lightseagreen and mediumpurple. Preserve case.",
    fields: [
      {
        name: "lightSeaGreen",
        type: "string",
        description: "Hex rgb value for lightseagreen",
        pattern: "^#[0-9A-Fa-f]{6}$",
      },
      {
        name: "mediumPurple",
        type: "string",
        description: "Hex rgb value for mediumpurple",
        pattern: "^#[0-9A-Fa-f]{6}$",
      },
    ],
    expected: { lightSeaGreen: "#20B2AA", mediumPurple: "#9370DB" },
  },
  {
    name: "binding_loc_languages",
    instruction:
      "From the language code tables, extract Albanian's ISO 639-1 code and its three-letter ISO 639-2 terminology code marked T.",
    fields: [
      {
        name: "alpha2",
        type: "string",
        description: "Albanian ISO 639-1 Code",
        pattern: "^[a-z]{2}$",
      },
      {
        name: "terminology",
        type: "string",
        description: "Albanian ISO 639-2 terminology code marked T",
        pattern: "^[a-z]{3}$",
      },
    ],
    expected: { alpha2: "sq", terminology: "sqi" },
  },
  {
    name: "binding_loc_missing",
    page: "binding_loc_languages",
    instruction:
      "Find the required ISO 639-1 code for Klingon from its table row. The result must come from the ISO 639-1 column.",
    fields: [
      {
        name: "klingon",
        type: "string",
        description: "Klingon ISO 639-1 Code",
        pattern: "^[a-z]{2}$",
      },
    ],
    expected: null,
  },
];

type Capture = {
  url: string;
  tables: HtmlTable[];
  snapshot: { formattedTree: string; urlMap: Record<string, string> };
};
const dir = resolve(process.argv[2] ?? "");
const rounds = Number(process.env.BINDING_ROUNDS ?? 2);
if (!process.argv[2] || !Number.isInteger(rounds) || rounds < 1)
  throw new Error("Expected capture directory and positive round count");
const model = { apiKey: process.env.PERPLEXITY_API_KEY!, modelName: "pplx-decider-v1.3" };
const arms = ["current-mapper", "table-cell"] as const;
type Arm = (typeof arms)[number];
const selectedCases =
  process.env.BINDING_TASKS?.split(",").map((name) => {
    const task = cases.find((entry) => entry.name === name);
    if (!task) throw new Error(`Unknown benchmark task ${name}`);
    return task;
  }) ?? cases.filter((task) => !task.control);

const packs = selectedCases.map((task) => {
  const raw = readFileSync(resolve(dir, (task.page ?? task.name) + ".json"));
  const capture = JSON.parse(raw.toString()) as Capture;
  const schema = z.object(
    Object.fromEntries(
      task.fields.map(({ name, description, type, pattern }) => {
        const field =
          type === "number"
            ? z.number()
            : pattern
              ? z.string().regex(new RegExp(pattern))
              : z.string();
        return [name, field.describe(description)];
      }),
    ),
  );
  const jsonSchema = z.toJSONSchema(schema) as JsonSchema;
  return {
    task,
    schema,
    jsonSchema,
    capture,
    hash: createHash("sha256").update(raw).digest("hex"),
    candidates: prepareTableScalarFromTables(capture.tables, jsonSchema, task.instruction),
  };
});
const manifest = packs.map(({ task, hash, candidates, capture, jsonSchema }) => ({
  task,
  hash,
  candidates,
  url: capture.url,
  jsonSchema,
}));
writeFileSync(
  resolve(dir, "manifest.json"),
  JSON.stringify({ arms, rounds, model: model.modelName, manifest }, null, 2),
);
if (process.env.BINDING_PREPARE_ONLY !== "1") {
  if (!model.apiKey) throw new Error("Missing PERPLEXITY_API_KEY");
  for (let round = 0; round < rounds; round++) {
    for (const [index, pack] of packs.entries()) {
      const offset = (round + index) % arms.length;
      for (const arm of [...arms.slice(offset), ...arms.slice(0, offset)]) {
        const record = await run(pack, arm, round);
        const line = JSON.stringify(record) + "\n";
        appendFileSync(resolve(dir, "results.jsonl"), line);
        process.stdout.write(line);
      }
    }
  }
}

type Pack = (typeof packs)[number];
async function run(pack: Pack, arm: Arm, round: number) {
  const { task, schema, jsonSchema, candidates, capture } = pack;
  const started = performance.now();
  const usage = { inputTokens: 0, outputTokens: 0, calls: 0 };
  let trace: unknown[] = [];
  const recordUsage = (value: { inputTokens: number; outputTokens: number }) => {
    usage.inputTokens += value.inputTokens;
    usage.outputTokens += value.outputTokens;
    usage.calls++;
  };
  let data: unknown = null;
  let reason: string | undefined;
  try {
    data = await runWithProgress(
      { name: "table binding probe", timeout: 25_000 },
      async (progress) => {
        const config: DecisionsConfig = {
          provider: "perplexity",
          apiKey: model.apiKey,
          model: model.modelName,
          signal: progress.signal,
          recordDecisionUsage: recordUsage,
        };
        const snapshot = capture.snapshot;
        if (arm === "current-mapper") {
          const result = await mapCopyExtract(config, {
            instruction: task.instruction,
            schema: jsonSchema,
            tree: snapshot.formattedTree,
            urlMap: snapshot.urlMap,
            reader: scalarReader(config, progress),
            readerChecks: true,
            verify: true,
            askVerifier: false,
          });
          trace.push(...result.trace);
          if (result.verdict?.problems.length) throw new Error(result.verdict.problems.join(","));
          return schema.parse(result.data);
        }
        if (!candidates) throw new Error("table_route_not_eligible");
        const cellTrace: Parameters<typeof extractTableScalar>[4] = [];
        trace = cellTrace;
        return schema.parse(
          await extractTableScalar(config, task.instruction, candidates, progress, cellTrace),
        );
      },
    );
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }
  return {
    task: task.name,
    arm,
    round,
    data,
    reason,
    usage,
    trace,
    passed:
      task.expected === null
        ? data === null &&
          !!reason &&
          /^(missing_table_cell|scalar-disagree|unresolved):/.test(reason)
        : isDeepStrictEqual(data, task.expected),
    wrongAccept: data !== null && !isDeepStrictEqual(data, task.expected),
    ms: Math.round(performance.now() - started),
  };
}
