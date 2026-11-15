import type { Action } from "@browserbasehq/stagehand-protocol/types";
import {
  actionNodes,
  type ActionSnapshot,
} from "../../../../extension/services/decisions/actionPlans.js";
import { describeCandidate } from "../../../../extension/services/decisions/tree.js";
import { fillValueCandidates } from "../../../../extension/services/decisions/args.js";
import {
  choiceAnswer,
  decide,
  noulAnswer,
  type DecisionModelConfig,
  type DecisionQuestion,
  type JsonValue,
} from "../../../../extension/services/decisions/client.js";
import type { OutlineNode } from "../../../../extension/services/decisions/outline.js";
import { trimTrailingTextNode } from "../../../../extension/utils.js";
import type { ObserveSnapshot } from "./common.js";

export type ObservationOutcome =
  | { kind: "done"; actions: Action[] }
  | { kind: "fallback"; reason: string };
const interactive =
  /\b(link|button|checkbox|radio|switch|tab|menuitem|menuitemcheckbox|menuitemradio|textbox|searchbox|combobox|spinbutton|textarea|select|listbox|inputtime|slider|treeitem|disclosuretriangle)\b/i;

export function observationView(snapshot: ObserveSnapshot) {
  const nodes = actionNodes(snapshot as ActionSnapshot);
  const seen = new Set<string>();
  const candidates = nodes.filter((node) => {
    const path = trimTrailingTextNode(snapshot.xpathMap[node.id]);
    const fact = snapshot.facts[node.id];
    if (
      !path ||
      seen.has(path) ||
      !fact?.visible ||
      !(interactive.test(node.role) || node.editable || /\bheading\b/i.test(node.role))
    )
      return false;
    seen.add(path);
    return true;
  });
  return { nodes, candidates };
}

function observationEvidence(snapshot: ObserveSnapshot, nodes: OutlineNode[], node: OutlineNode) {
  const full = describeCandidate(nodes, node);
  const fact = snapshot.facts[node.id]!;
  return {
    role: node.role,
    name: node.name,
    ...(full.within ? { within: full.within } : {}),
    ...(full.under_heading ? { heading: full.under_heading } : {}),
    ...(fact.context ? { context: fact.context } : {}),
    ...(fact.href ? { destination: fact.href } : {}),
    ...(fact.tag ? { tag: fact.tag } : {}),
    ...(node.parent !== undefined ? { parent_role: nodes[node.parent]!.role } : {}),
    enabled: fact.enabled,
    ...(fact.editable ? { editable: true } : {}),
    ...(fact.readonly ? { readonly: true } : {}),
  } as Record<string, JsonValue>;
}

export async function resolveObservation(
  config: DecisionModelConfig,
  snapshot: ObserveSnapshot,
  instruction: string | undefined,
  arm: string,
): Promise<ObservationOutcome> {
  const { nodes, candidates } = observationView(snapshot);
  const fallback = (reason: string): ObservationOutcome => ({ kind: "fallback", reason });
  const toAction = (node: OutlineNode, operation: string): Action => {
    const fact = snapshot.facts[node.id]!;
    const method =
      operation === "default"
        ? fact.tag === "select"
          ? "selectOptionFromDropdown"
          : fact.editable
            ? "fill"
            : "click"
        : operation;
    const values = instruction ? fillValueCandidates(instruction) : [];
    return {
      selector: `xpath=${trimTrailingTextNode(snapshot.xpathMap[node.id])}`,
      description: node.name ? `${node.role}: ${node.name}` : node.role,
      method,
      arguments: method === "fill" && values.length === 1 ? values : [],
    };
  };
  if (!instruction)
    return {
      kind: "done",
      actions: candidates
        .filter((n) => interactive.test(n.role) || n.editable)
        .map((n) => toAction(n, "default")),
    };
  if (candidates.length > (arm === "grouped" ? 1200 : 254))
    return fallback(`candidate_budget:${candidates.length}`);
  if (!candidates.length) return fallback("no_candidates");
  const evidence = Object.fromEntries(
    candidates.map((node) => [node.id, observationEvidence(snapshot, nodes, node)]),
  );
  if (arm === "local-visible")
    for (const node of candidates) evidence[node.id]!.visible_text = snapshot.facts[node.id]!.text;
  if (arm === "local-content")
    for (const node of candidates) {
      const fact = snapshot.facts[node.id]!;
      if (fact.tag === "a")
        evidence[node.id]!.link_content = fact.text
          ? "visible text link"
          : "image or icon link with no visible text";
    }
  if (arm === "routed-rich" || arm === "grouped")
    for (const node of candidates) {
      const children: string[] = [];
      for (let i = node.index + 1; i < nodes.length && nodes[i]!.depth > node.depth; i++) {
        if (children.length < 4) children.push(nodes[i]!.role);
      }
      evidence[node.id]!.child_roles = children;
    }
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
      instructions:
        "Does at least one listed candidate satisfy every constraint of the user's requested target? A related or similar element is not enough.",
    },
  };
  for (const node of candidates)
    questions[`match_${node.id}`] = {
      type: "noul",
      instructions: {
        question:
          "Does this specific candidate belong in the user's requested result set? Satisfy every requested kind, name, section and scope. A similar control or a wrapper around the target does not count. When asked for title links, image links do not count.",
        candidate: evidence[node.id]!,
      },
    };
  const routed = arm.startsWith("routed") || arm === "grouped";
  let response;
  if (routed) {
    const routeQuestions = Object.fromEntries(
      ["cardinality", "operation", "kind"].map((key) => [key, questions[key]!]),
    );
    const route = await decide(config, { instruction }, routeQuestions);
    if (
      choiceAnswer(route, "kind").choice !== "supported" ||
      choiceAnswer(route, "operation").choice === "unsupported"
    )
      return fallback("unsupported_observation");
    const one = choiceAnswer(route, "cardinality").choice === "one";
    if (arm === "grouped" && !one) {
      const groups = new Map<string, OutlineNode[]>();
      for (const node of candidates) {
        const key =
          node.id.split("-")[0] +
          ":" +
          snapshot.xpathMap[node.id]!.replace(/\[\d+\]/g, "") +
          ":" +
          node.role;
        const group = groups.get(key) ?? [];
        group.push(node);
        groups.set(key, group);
      }
      const lists = [...groups.values()];
      const groupedQuestions: Record<string, DecisionQuestion> = {};
      lists.forEach((members, i) => {
        groupedQuestions[`group_${i}`] = {
          type: "choice",
          instructions: {
            question:
              "Which inclusion rule exactly describes this complete group for the user's requested result set? Every member is listed. Satisfy every target-kind, name and scope constraint; image-only links differ from text title links.",
            members: members.map((node) => evidence[node.id]!),
          },
          criteria: {
            none: "No member matches the request",
            all: "Every member matches the request",
            filter:
              "Some members match and others do not, or membership needs individual examination",
          },
        };
      });
      if (JSON.stringify(groupedQuestions).length > 180000)
        return fallback("group_evidence_budget");
      const grouped = await decide(config, { instruction }, groupedQuestions);
      const accepted: OutlineNode[] = [];
      const uncertain: OutlineNode[] = [];
      for (const [i, members] of lists.entries()) {
        const answer = choiceAnswer(grouped, `group_${i}`);
        if (answer.choice === "all" && answer.confidence >= 0.85) accepted.push(...members);
        else if (answer.choice !== "none" || answer.confidence < 0.85) uncertain.push(...members);
      }
      if (uncertain.length) {
        const filtered = await decide(
          config,
          { instruction },
          Object.fromEntries(
            uncertain.map((node) => [`match_${node.id}`, questions[`match_${node.id}`]!]),
          ),
        );
        for (const node of uncertain) {
          const p = noulAnswer(filtered, `match_${node.id}`).noul;
          if (p > 0.1 && p < 0.8) return fallback("uncertain_set_member");
          if (p >= 0.8) accepted.push(node);
        }
      }
      const operation = choiceAnswer(route, "operation");
      if (operation.confidence < 0.7 || choiceAnswer(route, "cardinality").confidence < 0.7)
        return fallback("uncertain_route");
      if (operation.choice === "fill" && fillValueCandidates(instruction).length !== 1)
        return fallback("unbounded_arguments");
      return {
        kind: "done",
        actions: accepted
          .sort((a, b) => a.index - b.index)
          .map((node) => toAction(node, operation.choice)),
      };
    }
    if (one && candidates.length > 254) return fallback("single_choice_budget");
    const selection = Object.fromEntries(
      Object.entries(questions).filter(([key]) =>
        one ? ["target", "exists"].includes(key) : key.startsWith("match_"),
      ),
    );
    const picked = await decide(
      config,
      one ? { instruction, candidates: evidence } : { instruction },
      selection,
    );
    response = { ...picked, answers: { ...route.answers, ...picked.answers } };
  } else {
    if (arm.startsWith("local"))
      questions.exists = {
        type: "noul",
        instructions: { question: questions.exists!.instructions, candidates: evidence },
      };
    response = await decide(
      config,
      arm.startsWith("local") ? { instruction } : { instruction, candidates: evidence },
      questions,
    );
  }
  const operation = choiceAnswer(response, "operation");
  if (
    operation.choice === "unsupported" ||
    operation.confidence < 0.7 ||
    choiceAnswer(response, "kind").choice !== "supported"
  )
    return fallback("unsupported_observation");
  if (operation.choice === "fill" && fillValueCandidates(instruction).length !== 1)
    return fallback("unbounded_arguments");
  const cardinality = choiceAnswer(response, "cardinality");
  if (cardinality.confidence < 0.7) return fallback("uncertain_cardinality");
  if (cardinality.choice === "one") {
    const answer = choiceAnswer(response, "target");
    const exists = noulAnswer(response, "exists").noul;
    if (answer.choice === "none_match" && exists <= 0.1) return { kind: "done", actions: [] };
    if (
      answer.choice === "none_match" ||
      answer.confidence < 0.7 ||
      (arm !== "single" && exists < 0.7)
    )
      return fallback("target_uncertain");
    const node = candidates.find((n) => n.id === answer.choice);
    if (!node) return fallback("unknown_target");
    return { kind: "done", actions: [toAction(node, operation.choice)] };
  }
  const scored = candidates.map((node) => ({
    node,
    p: noulAnswer(response, `match_${node.id}`).noul,
  }));
  if (scored.some((x) => x.p > 0.1 && x.p < 0.8)) return fallback("uncertain_set_member");
  return {
    kind: "done",
    actions: scored.filter((x) => x.p >= 0.8).map((x) => toAction(x.node, operation.choice)),
  };
}
