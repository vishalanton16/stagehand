import { quotedStrings } from "../../../extension/services/decisions/args.js";
import type { DecisionModelConfig } from "../../../extension/services/decisions/client.js";
import {
  matchesObservationType,
  observationView,
  type ObservationSnapshot,
} from "../../../extension/services/decisions/observeCandidates.js";
import {
  selectObservation,
  type ObservationOutcome,
} from "../../../extension/services/decisions/observeSelection.js";

export type ReplayArm = (input: {
  snapshot: ObservationSnapshot;
  instruction: string | undefined;
  config: DecisionModelConfig;
}) => Promise<ObservationOutcome>;

export const runtime: ReplayArm = ({ snapshot, instruction, config }) =>
  selectObservation(config, snapshot, instruction);

// A provider-free control for quoted, single-target lookup.
export const literal: ReplayArm = async ({ snapshot, instruction, config }) => {
  if (!instruction?.trim()) return selectObservation(config, snapshot, instruction);
  const { candidates, unresolved } = observationView(snapshot);
  if (unresolved.length) return { kind: "fallback", reason: "unresolved_candidates" };
  const quoted = quotedStrings(instruction);
  const kind = /^Find (?:the |any )?(link|heading|button) "[^"]+"\.?$/i
    .exec(instruction.trim())?.[1]
    ?.toLowerCase();
  if (quoted.length !== 1 || !kind) return { kind: "fallback", reason: "unsupported_literal" };

  const normalize = (text: string) =>
    text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  const matches = candidates.filter(
    (candidate) =>
      matchesObservationType(candidate, kind) &&
      normalize(candidate.node.name) === normalize(quoted[0]!),
  );
  const match = matches[0];
  if (matches.length !== 1 || !match)
    return { kind: "fallback", reason: matches.length ? "ambiguous_literal" : "missing_literal" };
  return {
    kind: "done",
    actions: [
      { selector: match.selector, method: "click", arguments: [], description: match.node.name },
    ],
  };
};

export const hybrid: ReplayArm = async (input) => {
  const outcome = await literal(input);
  return outcome.kind === "done" ? outcome : runtime(input);
};
