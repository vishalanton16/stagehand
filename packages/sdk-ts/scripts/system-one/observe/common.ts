import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Action } from "@browserbasehq/stagehand-protocol/types";
import type { ElementFacts } from "../../../../extension/services/decisions/actionFacts.js";
import type { ObserveTask } from "./tasks.js";

export const root = fileURLToPath(new URL("../../../../../", import.meta.url));
export const hash = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
export const defaultInstruction =
  "Find elements that can be used for any future actions in the page. These may be navigation links, related pages, section/subsection links, buttons, or other interactive elements. Be comprehensive: if there are multiple elements that may be relevant for future actions, return all of them.";
export type ObserveSnapshot = {
  site: string;
  url: string;
  formattedTree: string;
  xpathMap: Record<string, string>;
  urlMap: Record<string, string>;
  facts: Record<string, ElementFacts>;
  editableIds: string[];
  snapshotMs: number;
  canonical: Record<string, string>;
};
export type ObserveLabel = ObserveTask & {
  available: boolean;
  required: string[];
  allowedPaths: string[];
  goldIds: string[];
  domCount: number;
  requiredGroups?: string[][];
};

export function archive(dir: string, fields: object) {
  const files = [
    ...readdirSync(join(root, "packages/extension/services/decisions"), {
      encoding: "utf8",
      withFileTypes: false,
    })
      .filter((f) => f.endsWith(".ts"))
      .map((f: string) => `packages/extension/services/decisions/${f}`),
    ...readdirSync(join(root, "packages/sdk-ts/scripts/system-one/observe"), {
      encoding: "utf8",
      withFileTypes: false,
    })
      .filter((f) => f.endsWith(".ts"))
      .map((f: string) => `packages/sdk-ts/scripts/system-one/observe/${f}`),
    "packages/extension/services/observeService.ts",
    "packages/extension/controllers/stagehandController.ts",
    "packages/extension/inference.ts",
    "packages/extension/prompt.ts",
  ];
  const sourceHashes: Record<string, string> = {};
  for (const file of files) {
    if (!existsSync(join(root, file))) continue;
    const data = readFileSync(join(root, file));
    const target = join(dir, "source", file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
    sourceHashes[file] = hash(data);
  }
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        revision: execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: root,
          encoding: "utf8",
        }).trim(),
        ...fields,
        sourceHashes,
      },
      null,
      2,
    ),
  );
}

export function grade(actions: Action[], label: ObserveLabel, snapshot: ObserveSnapshot) {
  const byPath = new Map(
    Object.entries(snapshot.xpathMap).map(([id, path]) => [
      path.replace(/\/text\(\)(?:\[\d+\])?$/, ""),
      snapshot.canonical[id] ?? path,
    ]),
  );
  const selected = actions.map((a) => byPath.get(a.selector.replace(/^xpath=/, "")) ?? a.selector);
  const required = new Set(label.required);
  const allowed = new Set(label.allowedPaths);
  const unique = new Set(selected);
  const groups = label.requiredGroups ?? [...required].map((path) => [path]);
  const missing = groups
    .filter((group) => !group.some((path) => unique.has(path)))
    .map((group) => group[0]!);
  const extra = [...unique].filter((path) => !allowed.has(path));
  const duplicateCount = selected.length - unique.size;
  const badActions = actions.filter(
    (a) =>
      (label.methods && !label.methods.includes(a.method ?? "")) ||
      (label.arguments && JSON.stringify(a.arguments ?? []) !== JSON.stringify(label.arguments)),
  );
  return {
    passed: !missing.length && !extra.length && !duplicateCount && !badActions.length,
    missing,
    extra,
    duplicateCount,
    badActions,
    precision: selected.length
      ? (selected.length - extra.length) / selected.length
      : required.size
        ? 0
        : 1,
    recall: groups.length ? (groups.length - missing.length) / groups.length : 1,
    falseEmpty: required.size > 0 && selected.length === 0,
  };
}
