import type { Action, Variables } from "@browserbasehq/stagehand-protocol/types";
import {
  choiceAnswer,
  decide,
  noulAnswer,
  type DecisionModelConfig,
  type DecisionQuestion,
} from "./client.js";
import { fillValueCandidates, redactDeep, redactor } from "./args.js";
import {
  isInteractive,
  observationView,
  type ObservationCandidate,
  type ObservationSnapshot,
} from "./observeCandidates.js";

export type ObservationOutcome =
  | { kind: "done"; actions: Action[] }
  | { kind: "fallback"; reason: string };
const ACCEPT = 0.8;
const REJECT = 0.1;
const CONFIDENCE = 0.7;

export async function selectObservation(
  config: DecisionModelConfig,
  snapshot: ObservationSnapshot,
  instruction: string | undefined,
  variables?: Variables,
): Promise<ObservationOutcome> {
  const { candidates, unresolved } = observationView(snapshot);
  const fallback = (reason: string): ObservationOutcome => ({ kind: "fallback", reason });
  if (instruction !== undefined && !instruction.trim()) return fallback("empty_instruction");
  if (unresolved.length) return fallback(`unrepresented_candidates:${unresolved.length}`);
  const toAction = (candidate: ObservationCandidate, operation: string): Action => {
    const method =
      operation === "default"
        ? candidate.fact.tag === "select"
          ? "selectOptionFromDropdown"
          : candidate.fact.editable
            ? "fill"
            : "click"
        : operation;
    const values = instruction ? fillValueCandidates(instruction, variables) : [];
    return {
      selector: candidate.selector,
      description: candidate.node.name
        ? `${candidate.node.role}: ${candidate.node.name}`
        : candidate.node.role,
      method,
      arguments: method === "fill" && values.length === 1 ? values : [],
    };
  };
  if (!instruction) {
    if (candidates.length > 400) return fallback("discovery_budget");
    return {
      kind: "done",
      actions: candidates.filter(isInteractive).map((c) => toAction(c, "default")),
    };
  }
  if (!candidates.length || candidates.length > 254)
    return fallback(`candidate_budget:${candidates.length}`);
  const evidence = Object.fromEntries(candidates.map((c) => [c.node.id, c.evidence]));
  const questions: Record<string, DecisionQuestion> = {
    cardinality: {
      type: "choice",
      instructions: "How many matching elements does the user's observation request ask to return?",
      criteria: {
        one: "One specific target",
        all: "Several matching elements, each matching element, every match, or all matches",
      },
    },
    operation: {
      type: "choice",
      instructions:
        "Which method does the user explicitly ask to perform? Finding or locating elements alone uses default. Do not invent values or infer a click when merely finding fields.",
      criteria: {
        default: "Only find/locate targets; choose each target's normal method",
        click: "Explicit click or toggle",
        fill: "Explicit type/fill with literal supplied text",
        hover: "Explicit hover",
        doubleClick: "Explicit double click",
        unsupported:
          "Select an option, scroll, key press, drag, upload, or another operation needing other arguments",
      },
    },
    kind: {
      type: "choice",
      instructions: "What kind of target does the instruction seek?",
      criteria: {
        supported: "Controls, links, form fields, or headings",
        other: "Other readable text, paragraphs, sections, or unsupported page content",
      },
    },
    target: {
      type: "choice",
      instructions:
        "Which single element best matches the entire request? Return none_match when no listed element satisfies the target and context. This question is used only for one-target requests.",
      criteria: { ...evidence, none_match: "No listed element satisfies the request" },
    },
    exists: {
      type: "noul",
      instructions: {
        question:
          "Does at least one listed candidate satisfy every constraint of the user's requested target? A related or similar element is not enough.",
        candidates: evidence,
      },
    },
  };
  for (const candidate of candidates)
    questions[`match_${candidate.node.id}`] = {
      type: "noul",
      instructions: {
        question:
          "Does this candidate belong in the user's requested result set under membership_rules?",
        candidate: candidate.evidence,
      },
    };
  // Each membership question needs its own evidence, not every competing candidate in shared state.
  const redact = redactor(variables);
  const context = {
    instruction,
    membership_rules:
      "For each match_ question, satisfy every requested kind, name, section and scope. A similar control or a wrapper around the target does not count. Match the requested semantic and visual element kind, not merely a shared accessible name.",
  };
  const state = redact ? redactDeep(context, redact) : context;
  const safeQuestions = redact ? redactDeep(questions, redact) : questions;
  // Hosted Clef Flash truncates beyond 24k tokens. A conservative byte bound reserves room for its prompt.
  if (
    config.provider === "cloudflare" &&
    config.model?.endsWith("clef-flash") &&
    new TextEncoder().encode(JSON.stringify({ state, questions: safeQuestions })).byteLength > 12000
  )
    return fallback("provider_context_budget");
  const response = await decide(config, state, safeQuestions);
  const operation = choiceAnswer(response, "operation");
  const kind = choiceAnswer(response, "kind");
  const cardinality = choiceAnswer(response, "cardinality");
  if (
    operation.choice === "unsupported" ||
    operation.confidence < CONFIDENCE ||
    kind.choice !== "supported" ||
    kind.confidence < CONFIDENCE
  )
    return fallback("unsupported_observation");
  if (operation.choice === "fill" && fillValueCandidates(instruction, variables).length !== 1)
    return fallback("unbounded_arguments");
  if (cardinality.confidence < CONFIDENCE) return fallback("uncertain_cardinality");
  if (cardinality.choice === "one") {
    const answer = choiceAnswer(response, "target");
    const exists = noulAnswer(response, "exists").noul;
    if (answer.choice === "none_match" && exists <= REJECT) return { kind: "done", actions: [] };
    if (answer.choice === "none_match" || answer.confidence < CONFIDENCE || exists < CONFIDENCE)
      return fallback("target_uncertain");
    const selected = candidates.find((c) => c.node.id === answer.choice);
    return selected
      ? { kind: "done", actions: [toAction(selected, operation.choice)] }
      : fallback("unknown_target");
  }
  const scored = candidates.map((candidate) => ({
    candidate,
    p: noulAnswer(response, `match_${candidate.node.id}`).noul,
  }));
  if (scored.some((x) => x.p > REJECT && x.p < ACCEPT)) return fallback("uncertain_set_member");
  return {
    kind: "done",
    actions: scored
      .filter((x) => x.p >= ACCEPT)
      .map((x) => toAction(x.candidate, operation.choice)),
  };
}
