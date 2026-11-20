import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Action } from "@browserbasehq/stagehand-protocol/types";
import type { ObservationSnapshot } from "../../../extension/services/decisions/observeCandidates.js";
import { trimTrailingTextNode } from "../../../extension/utils.js";
import manifest from "../system-one-study/manifest.json" with { type: "json" };

type Target = { node: string; method: string; arguments?: string[] };

export function loadFreshCorpus(archive: string) {
  const labelDigest = createHash("sha256").update(JSON.stringify(manifest.cases)).digest("hex");
  return manifest.captures.map(({ site, sha256 }) => {
    const bytes = readFileSync(join(archive, sha256 + ".json"));
    if (createHash("sha256").update(bytes).digest("hex") !== sha256) {
      throw new Error(`Digest mismatch for ${site}`);
    }
    const snapshot = JSON.parse(bytes.toString()) as ObservationSnapshot;
    const labels = manifest.cases
      .filter((studyCase) => studyCase.site === site)
      .map((studyCase) => {
        const labels = studyCase.targets.map(({ node, method, arguments: args }: Target) => {
          const path = trimTrailingTextNode(snapshot.xpathMap[node]);
          if (!path || !snapshot.facts[node]?.visible)
            throw new Error(`Unavailable label for ${studyCase.id}`);
          return { selector: `xpath=${path}`, method, arguments: args };
        });
        const expected = new Set(labels.map(key));
        const expectedSelectors = new Set(labels.map(({ selector }) => selector));
        const oneOf = studyCase.match === "one-of";
        const count = oneOf ? 1 : expected.size;
        const workload = !studyCase.instruction
          ? "discovery"
          : count === 0
            ? "empty"
            : count > 1
              ? "all"
              : "one";
        return {
          name: studyCase.id,
          available: true,
          workload,
          instruction: studyCase.instruction ?? undefined,
          check(actions: Action[]) {
            const actual = actions.map(key);
            const matched = new Set(actual.filter((action) => expected.has(action))).size;
            const duplicates = actual.length - new Set(actual).size;
            const missing = Math.max(0, count - matched);
            const extra = actual.length - duplicates - Math.min(matched, count);
            const selectors = new Set(actions.map(({ selector }) => selector));
            const targetsPassed =
              actions.length === count &&
              selectors.size === count &&
              [...selectors].every((selector) => expectedSelectors.has(selector));
            return {
              passed: !(duplicates || missing || extra),
              targetsPassed,
              missing,
              extra,
              duplicates,
              badActions: 0,
            };
          },
        };
      });
    return { page: site, snapshotDigest: sha256, labelDigest, snapshot, labels };
  });
}

function key(action: Pick<Action, "selector" | "method" | "arguments">) {
  return JSON.stringify([action.selector, action.method, action.arguments ?? []]);
}
