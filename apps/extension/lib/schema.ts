import { Validator, type Schema } from "@cfworker/json-schema";
import type { Arguments } from "./webmcp";

type FieldSchema = {
  title?: string;
  description?: string;
  type?: string;
  enum?: unknown[];
  default?: unknown;
};

export type Field = FieldSchema & { name: string; required: boolean };

export function objectValue(value: unknown): value is Arguments {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeSchema(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

export function schemaFields(raw: unknown): Field[] | null {
  const schema = normalizeSchema(raw);
  if (!objectValue(schema) || !objectValue(schema.properties)) return null;
  return Object.entries(schema.properties).map(([name, property]) => ({
    ...(objectValue(property) ? (property as FieldSchema) : {}),
    name,
    required: Array.isArray(schema.required) && schema.required.includes(name),
  }));
}

export function checkArguments(raw: unknown, input: Arguments): string | undefined {
  const schema = normalizeSchema(raw);
  if (!objectValue(schema) && typeof schema !== "boolean") {
    return "This tool published an invalid JSON Schema.";
  }
  const draft =
    objectValue(schema) && typeof schema.$schema === "string"
      ? schema.$schema.match(/(?:draft[-/])(04|06|07|2019-09|2020-12)/)?.[1]
      : undefined;
  try {
    const validation = new Validator(
      schema as Schema,
      (draft ?? "2020-12") as ConstructorParameters<typeof Validator>[1],
      true,
    ).validate(input);
    const error = validation.errors[0];
    if (error) return `${error.instanceLocation.replace(/^#/, "") || "Input"}: ${error.error}`;
  } catch {
    return "Could not validate this tool's JSON Schema.";
  }
}

export function pretty(value: unknown) {
  return JSON.stringify(value, null, 2) ?? "null";
}
