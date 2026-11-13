import type {
  ExtractResult,
  StagehandExtractParams,
  StagehandResultUsage,
} from "@browserbasehq/stagehand-protocol/types";
import { z } from "zod/v4";
import type { Page } from "../../understudy/page.js";
import type { Progress } from "../../understudy/progress.js";
import { disabledCacheMetadata, zeroStagehandResultUsage } from "../resultUsage.js";

const responseSchema = z.object({
  answers: z.record(
    z.string(),
    z.object({
      type: z.literal("locate"),
      spans: z.array(
        z.object({
          start: z.number().int().nonnegative(),
          end: z.number().int().nonnegative(),
          text: z.string().min(1),
          score: z.number(),
        }),
      ),
    }),
  ),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});

const schemaNode = z.object({
  type: z.union([z.string(), z.array(z.string())]).optional(),
  description: z.string().optional(),
  items: z.unknown().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  required: z.array(z.string()).optional(),
  anyOf: z.array(z.unknown()).optional(),
});

function compileField(raw: unknown, name: string, task: string) {
  const original = schemaNode.parse(raw);
  let node = original;
  if (original.anyOf?.length === 2) {
    const variants = original.anyOf.map((variant) => schemaNode.parse(variant));
    const value = variants.find((variant) => variant.type !== "null");
    if (value && variants.some((variant) => variant.type === "null")) node = value;
  }
  if (
    Array.isArray(original.type) &&
    original.type.length === 2 &&
    original.type.includes("null")
  ) {
    node = { ...original, type: original.type.find((type) => type !== "null") };
  }
  const list = node.type === "array";
  const type = list ? schemaNode.parse(node.items).type : node.type;
  if (type !== "string" && type !== "number" && type !== "integer") {
    throw new TypeError(`Decider locate does not support the extraction schema for "${name}"`);
  }
  const description = original.description ?? node.description;
  const target = name.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  const instructions = [
    task,
    list
      ? `Find each value for ${target} as a separate span.`
      : `Find the exact value for ${target}.`,
    description,
    type === "string" ? undefined : "Return the number as written, without surrounding text.",
  ]
    .filter(Boolean)
    .join("\n");
  return { name, type, list, nullable: node !== original, instructions };
}

function parseNumber(text: string): number | undefined {
  // Accept a single decimal value with optional grouping and a currency symbol.
  const value = text
    .trim()
    .replace(/^[$€£]\s*/, "")
    .replace(/\s*[$€£]$/, "");
  if (!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(value)) return undefined;
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function extractWithDecider({
  params,
  page,
  model,
  systemPrompt,
  progress,
  recordUsage,
}: {
  params: StagehandExtractParams;
  page: Pick<Page, "captureSnapshot">;
  model: { apiKey: string; modelName: string };
  systemPrompt: string;
  progress: Progress;
  recordUsage?: (usage: StagehandResultUsage) => void;
}): Promise<ExtractResult> {
  const { options, instruction } = params;
  if (options?.screenshot) throw new TypeError("Decider locate requires a text snapshot");
  const root = schemaNode.parse(params.schema);
  const isObject = root.type === "object";
  const entries: [string, unknown][] = isObject
    ? Object.entries(root.properties ?? {})
    : [["value", params.schema]];
  if (entries.length < 1 || entries.length > 128) {
    throw new TypeError("Decider locate requires between 1 and 128 fields");
  }
  const task = [systemPrompt, root.description, instruction].filter(Boolean).join("\n");
  const fields = entries.map(([name, node]) => compileField(node, name, task));
  const questions = Object.fromEntries(
    fields.map(({ name, instructions }) => [name, { type: "locate", instructions }]),
  );
  const validator = z.fromJSONSchema(params.schema as Parameters<typeof z.fromJSONSchema>[0]);
  const { combinedTree: state } = await page.captureSnapshot(
    { focusLocator: options?.locator, ignoreLocators: options?.ignoreLocators },
    progress,
  );
  if (!state.trim()) throw new Error("Decider locate requires a nonempty page snapshot");

  const started = performance.now();
  const result = await progress.run("waiting for Decider inference", async () => {
    const response = await fetch("https://api.perplexity.ai/v1/decisions", {
      method: "POST",
      headers: { Authorization: `Bearer ${model.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: model.modelName, state, questions }),
      signal: progress.signal,
    });
    if (!response.ok)
      throw new Error(`Perplexity Decider request failed (HTTP ${response.status})`);
    return responseSchema.parse(await response.json());
  });
  const usage = {
    ...zeroStagehandResultUsage(),
    inputTokens: result.usage.input_tokens,
    outputTokens: result.usage.output_tokens,
    inferenceTimeMs: Math.round(performance.now() - started),
  };
  recordUsage?.(usage);

  const required = new Set(root.required);
  const values = Object.fromEntries(
    fields.flatMap(({ name, type, list, nullable }) => {
      if (!Object.hasOwn(result.answers, name))
        throw new Error(`Decider response omitted field "${name}"`);
      const { spans } = result.answers[name];
      const ordered = list
        ? spans.toSorted((a, b) => a.start - b.start)
        : spans.toSorted((a, b) => b.score - a.score);
      const candidates = ordered.flatMap(({ text }) => {
        const value = type === "string" ? text.trim() : parseNumber(text);
        return value === undefined || (type === "integer" && !Number.isInteger(value))
          ? []
          : [value];
      });
      const value = list ? candidates : (candidates[0] ?? null);
      if (isObject && value === null && !nullable && !required.has(name)) return [];
      return [[name, value] as const];
    }),
  );
  return {
    data: z.json().parse(validator.parse(isObject ? values : values.value)),
    metadata: { cache: disabledCacheMetadata(), usage },
  };
}
