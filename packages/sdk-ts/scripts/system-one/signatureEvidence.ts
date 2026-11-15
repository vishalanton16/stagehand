import type { JsonSchema } from "../../../extension/services/decisions/mapCopy.js";
import { parseOutline } from "../../../extension/services/decisions/tree.js";

const identifier = /[a-z_$][\w$]*/i;
const number = "[+-]?(?:\\d+)(?:\\.\\d+)?";
const assignment = new RegExp(
  `^(${identifier.source})(?:\\s*:\\s*[^=]+)?\\s*=\\s*(${number})$`,
  "i",
);
const callable = /^(?:class\s+)?([a-z_$][\w$.]*)\s*\((.*)\)(?:\s*(?:→|->)\s*[^()]*)?$/i;

type Match = { signature: string; parameter: string; literal: string; quote: string };

function splitParameters(text: string): string[] {
  const parts: string[] = [];
  const brackets: string[] = [];
  let quote = "";
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = "";
    } else if (char === "'" || char === '"') quote = char;
    else if (char === "(" || char === "[" || char === "{") brackets.push(char);
    else if (char === ")" || char === "]" || char === "}") {
      if (brackets.pop() !== { ")": "(", "]": "[", "}": "{" }[char]) return [];
    } else if (char === "," && !brackets.length) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (brackets.length || quote) return [];
  parts.push(text.slice(start).trim());
  return parts;
}

function mentions(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w$.])${escaped}(?![\\w$.])`, "i").test(text);
}

export function numericAssignment(quote: string) {
  const match = assignment.exec(quote);
  return match && { parameter: match[1]!, literal: match[2]! };
}

export function signatureEvidence(tree: string, schema: JsonSchema) {
  const signatures = new Set(
    parseOutline(tree).flatMap((node) =>
      /^(?:term|code|heading)$/i.test(node.role) && node.name.length <= 900 ? [node.name] : [],
    ),
  );
  const fields = Object.entries(schema.properties ?? {});
  const matches = new Map<string, Match[]>();
  for (const signature of signatures) {
    const match = callable.exec(signature);
    if (!match) continue;
    const [, name, parameters] = match;
    const shortName = name!.split(".").at(-1)!;
    const defaults = splitParameters(parameters!).flatMap((quote) => {
      const defaultValue = numericAssignment(quote);
      return defaultValue ? [{ ...defaultValue, quote, signature }] : [];
    });
    for (const [key, field] of fields) {
      if (field.type !== "number" && field.type !== "integer") continue;
      const description = field.description ?? "";
      if (
        !/\bdefault\b/i.test(description) ||
        (!mentions(description, name!) && !mentions(description, shortName))
      )
        continue;
      const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
      for (const value of defaults) {
        if (value.parameter.toLowerCase() !== normalized && !mentions(description, value.parameter))
          continue;
        const existing = matches.get(key);
        if (existing) existing.push(value);
        else matches.set(key, [value]);
      }
    }
  }
  return new Map(
    [...matches].flatMap(([field, entries]) =>
      entries.length === 1 ? [[field, entries[0]!] as const] : [],
    ),
  );
}
