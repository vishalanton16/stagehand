import type {
  ExtractResult,
  StagehandExtractParams,
  StagehandResultUsage,
} from "@browserbasehq/stagehand-protocol/types";
import { z } from "zod/v4";
import { bytesToBase64 } from "../../understudy/fileUploadUtils.js";
import type { Page } from "../../understudy/page.js";
import type { Progress } from "../../understudy/progress.js";
import { disabledCacheMetadata, zeroStagehandResultUsage } from "../resultUsage.js";

type Scalar = "text" | "number" | "date" | "time" | "datetime";
type Field = (
  | { type: Scalar; integer?: true }
  | { type: "list"; items: "text" | "number" | "date" }
) & { instructions: string };

const schemaNode = z.looseObject({
  type: z.union([z.string(), z.array(z.string())]).optional(),
  format: z.string().optional(),
  description: z.string().optional(),
  items: z.unknown().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  required: z.array(z.string()).optional(),
  anyOf: z.array(z.unknown()).optional(),
});
type SchemaNode = z.infer<typeof schemaNode>;

const responseSchema = z.object({
  success: z.literal(true),
  result: z.object({
    answers: z.record(z.string(), z.object({ value: z.json() })),
    truncated: z.boolean(),
    usage: z.object({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
    }),
  }),
});

function scalarType(node: SchemaNode): Scalar | undefined {
  if (node.type === "number" || node.type === "integer") return "number";
  if (node.type !== "string") return undefined;
  switch (node.format) {
    case "date":
    case "time":
      return node.format;
    case "date-time":
      return "datetime";
    default:
      return "text";
  }
}

function compileField(
  raw: unknown,
  name: string,
  task: string,
): { field: Field; nullable: boolean } {
  const original = schemaNode.parse(raw);
  let node = original;
  if (original.anyOf?.length === 2) {
    const variants = original.anyOf.map((variant) => schemaNode.parse(variant));
    const [value] = variants.filter((variant) => variant.type !== "null");
    if (value && variants.some((variant) => variant.type === "null")) node = value;
  }
  if (
    Array.isArray(original.type) &&
    original.type.length === 2 &&
    original.type.includes("null")
  ) {
    node = { ...original, type: original.type.find((type) => type !== "null") };
  }
  const description = original.description ?? node.description;
  const instructions = [task, `Field: ${name}`, description].filter(Boolean).join("\n");
  const type = scalarType(node);
  if (type) {
    return {
      field: { type, instructions, ...(node.type === "integer" ? { integer: true } : {}) },
      nullable: node !== original,
    };
  }
  if (node.type === "array" && node.items) {
    const items = scalarType(schemaNode.parse(node.items));
    if (items === "text" || items === "number" || items === "date") {
      return { field: { type: "list", items, instructions }, nullable: node !== original };
    }
  }
  throw new TypeError(`Clairic does not support the extraction schema for "${name}"`);
}

export async function extractWithClairic({
  params,
  page,
  model,
  systemPrompt,
  progress,
  recordUsage,
}: {
  params: StagehandExtractParams;
  page: Pick<Page, "captureSnapshot" | "screenshot">;
  model: { apiKey: string; accountId: string };
  systemPrompt: string;
  progress: Progress;
  recordUsage?: (usage: StagehandResultUsage) => void;
}): Promise<ExtractResult> {
  const { options, instruction } = params;
  const root = schemaNode.parse(params.schema);
  const isObject = root.type === "object";
  const properties: [string, unknown][] = isObject
    ? Object.entries(root.properties ?? {})
    : [["value", root]];
  if (properties.length === 0)
    throw new TypeError("Clairic requires at least one extraction field");

  const task = [systemPrompt, root.description, instruction].filter(Boolean).join("\n");
  const compiled = properties.map(([name, node]) => ({ name, ...compileField(node, name, task) }));
  const fields = Object.fromEntries(compiled.map(({ name, field }) => [name, field]));
  const validator = z.fromJSONSchema(params.schema as Parameters<typeof z.fromJSONSchema>[0]);
  const { combinedTree } = await page.captureSnapshot(
    { focusLocator: options?.locator, ignoreLocators: options?.ignoreLocators },
    progress,
  );
  const screenshot = options?.screenshot
    ? await page.screenshot({ fullPage: false, type: "png" }, progress)
    : undefined;
  if (!combinedTree.trim() && !screenshot) {
    throw new Error("Clairic requires a nonempty page snapshot or screenshot");
  }
  if (screenshot && screenshot.byteLength > 4 * 1024 * 1024) {
    throw new Error("Clairic accepts screenshots up to 4 MiB");
  }

  const started = performance.now();
  const result = await progress.run("waiting for Clairic inference", async () => {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(model.accountId)}/ai/run/@cf/cloudflare/clairic`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${model.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "clairic",
          state: combinedTree,
          fields,
          ...(screenshot ? { images: [`data:image/png;base64,${bytesToBase64(screenshot)}`] } : {}),
        }),
        signal: progress.signal,
      },
    );
    if (!response.ok) {
      throw new Error(`Cloudflare Clairic request failed (HTTP ${response.status})`);
    }
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error("Cloudflare returned an invalid Clairic response");
    return parsed.data.result;
  });
  const usage = {
    ...zeroStagehandResultUsage(),
    inputTokens: result.usage.input_tokens,
    outputTokens: result.usage.output_tokens,
    inferenceTimeMs: Math.round(performance.now() - started),
  };
  // The provider consumed tokens even if the result cannot satisfy the schema.
  recordUsage?.(usage);
  if (result.truncated) throw new Error("Cloudflare truncated the Clairic extraction input");

  const required = new Set(root.required);
  const values = Object.fromEntries(
    compiled.flatMap(({ name, nullable }) => {
      if (!Object.hasOwn(result.answers, name)) {
        throw new Error(`Clairic response omitted field "${name}"`);
      }
      const { value } = result.answers[name];
      if (isObject && !required.has(name) && value === null && !nullable) return [];
      return [[name, value] as const];
    }),
  );
  return {
    data: z.json().parse(validator.parse(isObject ? values : values.value)),
    metadata: {
      cache: disabledCacheMetadata(),
      usage,
    },
  };
}
