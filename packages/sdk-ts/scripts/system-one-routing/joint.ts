import { fillValueCandidates } from "../../../extension/services/decisions/args.js";
import {
  choiceAnswer,
  decide,
  noulAnswer,
  type DecisionModelConfig,
  type DecisionQuestion,
} from "../../../extension/services/decisions/client.js";
import {
  observationView,
  type ObservationSnapshot,
} from "../../../extension/services/decisions/observeCandidates.js";
import type { ObservationOutcome } from "../../../extension/services/decisions/observeSelection.js";

const MAX_CANDIDATES = 40;
const MAX_REQUEST_BYTES = 10_000;
const CONFIDENCE = 0.8;

export async function selectJointObservation(
  config: DecisionModelConfig,
  snapshot: ObservationSnapshot,
  instruction?: string,
): Promise<ObservationOutcome> {
  if (!instruction?.trim()) return { kind: "fallback", reason: "joint_no_instruction" };
  const { candidates, unresolved } = observationView(snapshot);
  if (unresolved.length || !candidates.length || candidates.length > MAX_CANDIDATES) {
    return { kind: "fallback", reason: "joint_candidate_coverage" };
  }

  const state = { instruction };
  const questions: Record<string, DecisionQuestion> = {
    method: {
      type: "choice",
      instructions: "Which supported operation does this request ask for on exactly one element?",
      criteria: {
        default: "Find or identify one specific control, link, field or heading",
        click: "Explicitly click or toggle one element",
        fill: "Explicitly type a literal supplied value into one editable field",
        hover: "Explicitly hover one element",
        doubleClick: "Explicitly double-click one element",
        unsupported:
          "Several or all targets, no specific target, other content, or another operation",
      },
    },
    unique: {
      type: "noul",
      instructions:
        "Does the user's instruction ask for exactly one supported element? Answer no for set requests, general discovery, or unsupported content such as paragraphs or containers.",
    },
    target: {
      type: "choice",
      instructions:
        "Pick the element that itself satisfies every requested kind, label and scope. Choose none_match if the target is absent or several elements are equally good. A wrapper or an image-only link is not a text link.",
      criteria: {
        ...Object.fromEntries(
          candidates.map((candidate) => [candidate.node.id, candidate.evidence]),
        ),
        none_match: "No unique element satisfies the entire request",
      },
    },
  };
  if (Buffer.byteLength(JSON.stringify({ state, questions })) > MAX_REQUEST_BYTES) {
    return { kind: "fallback", reason: "joint_request_budget" };
  }

  const response = await decide(config, state, questions);
  const method = choiceAnswer(response, "method");
  const target = choiceAnswer(response, "target");
  if (
    method.choice === "unsupported" ||
    method.confidence < CONFIDENCE ||
    noulAnswer(response, "unique").noul < CONFIDENCE
  ) {
    return { kind: "fallback", reason: "joint_unsupported_or_uncertain_intent" };
  }
  const candidate = candidates.find(({ node }) => node.id === target.choice);
  if (!candidate || target.confidence < CONFIDENCE) {
    return { kind: "fallback", reason: "joint_uncertain_target" };
  }

  const values = method.choice === "fill" ? fillValueCandidates(instruction) : [];
  if (method.choice === "fill" && (values.length !== 1 || !candidate.fact.editable)) {
    return { kind: "fallback", reason: "joint_unbounded_arguments" };
  }
  const actionMethod =
    method.choice === "default"
      ? candidate.fact.tag === "select"
        ? "selectOptionFromDropdown"
        : candidate.fact.editable
          ? "fill"
          : "click"
      : method.choice;
  return {
    kind: "done",
    actions: [
      {
        selector: candidate.selector,
        description: candidate.node.name
          ? `${candidate.node.role}: ${candidate.node.name}`
          : candidate.node.role,
        method: actionMethod,
        arguments: values,
      },
    ],
  };
}
