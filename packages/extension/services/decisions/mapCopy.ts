/**
 * Map-and-copy extraction. Stagehand builds a data view (record groups with
 * aligned slots, labelled facts); the decision model only answers small
 * mapping questions over it; code copies every value. The number of model
 * calls does not grow with the length of a list.
 */
import { decide, type DecisionModelConfig, type DecisionQuestion } from "./client.js";
import type { OutlineNode } from "./tree.js";
import {
  buildDataView,
  clip,
  readSlot,
  recordText,
  type DataView,
  type Fact,
  type Group,
  type Slot,
} from "./dataView.js";

export type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  format?: string;
  description?: string;
  anyOf?: JsonSchema[];
};

type FieldType = "string" | "number" | "integer" | "url";
type Field = {
  name: string;
  description: string;
  type: FieldType;
  required: boolean;
  nullable?: boolean;
};
type ListPlan = {
  name: string;
  description: string;
  fields: Field[];
  scalarItems: boolean;
  required: boolean;
};

export type TraceEntry = {
  step: string;
  choice: string;
  confidence: number;
  options: number;
  sourceIds?: string[];
  recordId?: string;
};

/**
 * A span or field extractor (Perplexity Decider locate, Cloudflare Clairic)
 * that reads single values from a small fact sheet the data view prepares.
 */
export type ScalarReader = (input: {
  sheet: string;
  fields: { name: string; type: "string" | "number"; instructions: string }[];
}) => Promise<Record<string, string | number | null | undefined>>;

const NONE = "none";

async function ask(
  config: DecisionModelConfig,
  state: Parameters<typeof decide>[1],
  questions: Record<string, DecisionQuestion>,
) {
  return decide(config, state, questions);
}
const STOP = new Set(
  "the a an of and or to in on for with by from at as is are be this that these those all each every any extract find get list their its it his her them they which what who whose do not include".split(
    " ",
  ),
);

export function tokens(text: string): Set<string> {
  return new Set(
    Array.from(text.toLowerCase().matchAll(/[\p{L}\d]+/gu), (match) => match[0])
      .filter((token) => !STOP.has(token) && (token.length > 1 || /\d/.test(token)))
      .map((token) => token.replace(/(ing|ed|es|s)$/, "") || token),
  );
}

const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((token) => b.has(token)).length;

function fieldType(node: JsonSchema): FieldType | undefined {
  const variants = node.anyOf?.filter((variant) => variant.type !== "null");
  if (variants?.length === 1) return fieldType(variants[0]!);
  const type = Array.isArray(node.type) ? node.type.find((t) => t !== "null") : node.type;
  if (type === "string") return node.format === "uri" ? "url" : "string";
  if (type === "number" || type === "integer") return type;
  return undefined;
}

function nullable(node: JsonSchema): boolean {
  return (
    node.type === "null" ||
    (Array.isArray(node.type) && node.type.includes("null")) ||
    !!node.anyOf?.some((variant) => variant.type === "null")
  );
}

function plan(schema: JsonSchema) {
  if (schema.type !== "object" || !schema.properties) throw new Error("unsupported:root");
  const lists: ListPlan[] = [];
  const scalars: Field[] = [];
  const required = new Set(schema.required ?? []);
  for (const [name, node] of Object.entries(schema.properties ?? {})) {
    const description = node.description ?? "";
    const type = fieldType(node);
    if (type) {
      scalars.push({
        name,
        description,
        type,
        required: required.has(name),
        nullable: nullable(node),
      });
      continue;
    }
    if (node.type === "array" && node.items) {
      const itemType = fieldType(node.items);
      if (itemType) {
        lists.push({
          name,
          description,
          scalarItems: true,
          required: required.has(name),
          fields: [
            {
              name,
              description: node.items.description ?? description,
              type: itemType,
              required: true,
            },
          ],
        });
        continue;
      }
      const itemRequired = new Set(node.items.required ?? []);
      const fields = Object.entries(node.items.properties ?? {}).map(([field, child]) => {
        const childType = fieldType(child);
        if (!childType) throw new Error(`unsupported:${name}.${field}`);
        return {
          name: field,
          description: child.description ?? "",
          type: childType,
          required: itemRequired.has(field),
          nullable: nullable(child),
        };
      });
      lists.push({ name, description, fields, scalarItems: false, required: required.has(name) });
      continue;
    }
    throw new Error(`unsupported:${name}`);
  }
  return { lists, scalars };
}

const fieldText = (field: Field) =>
  `${field.name.replaceAll("_", " ")}${field.description ? ` (${field.description})` : ""}`;

function choiceOf(
  answers: Record<string, unknown>,
  key: string,
  trace: TraceEntry[],
  step: string,
  options: number,
): { choice: string; confidence: number } {
  const answer = answers[key] as { type: string; choice?: string; confidence?: number } | undefined;
  const choice = answer?.type === "choice" ? (answer.choice ?? NONE) : NONE;
  const confidence = answer?.confidence ?? 0;
  trace.push({ step, choice, confidence, options });
  return { choice, confidence };
}

/** A reason to hand the page to the fallback model, collected by the verdict. */
function problem(trace: TraceEntry[], reason: string) {
  trace.push({ step: "problem", choice: reason, confidence: 0, options: 0 });
}

function noulOf(answers: Record<string, unknown>, key: string): number {
  const answer = answers[key] as { type: string; noul?: number } | undefined;
  return answer?.type === "noul" ? (answer.noul ?? 0) : 0;
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/**
 * The numbers the instruction itself mentions ("the 5 tallest", "first ten"),
 * offered to the model as possible item counts. Which one (if any) is a count
 * is the model's call, not a phrase pattern's.
 */
function countOptions(instruction: string): number[] {
  const numbers = (
    instruction.match(/\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi) ?? []
  ).map((token) => WORD_NUMBERS[token.toLowerCase()] ?? Number(token));
  return [...new Set(numbers)].filter((n) => n >= 1 && n <= 500);
}

/** Every number in `text` with a little context, for the model to choose from. */
export function numberCandidates(text: string): { value: number; shown: string }[] {
  return [...text.matchAll(NUMBER)].flatMap((match) => {
    const value = parseNumber(match[0], new Set());
    if (value === undefined) return [];
    const at = match.index!;
    const shown = `…${text.slice(Math.max(0, at - 40), at)}[${match[0]}]${text.slice(at + match[0].length, at + match[0].length + 25)}…`;
    return [{ value, shown: shown.replace(/\s+/g, " ") }];
  });
}

const NUMBER =
  /(?<![\p{L}\d])[-+]?\$?\d[\d,]*(?:\.\d+)?(?![\d.,]\d)(?:(k|m|bn?)|\s?(thousand|million|billion))?(?!-?\p{L})/giu;
const UNITS: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
};

export function parseNumber(text: string, hint: Set<string>): number | undefined {
  const matches = [...text.matchAll(NUMBER)];
  if (matches.length === 0) {
    const word = Object.keys(WORD_NUMBERS).find((w) => new RegExp(`\\b${w}\\b`, "i").test(text));
    return word ? WORD_NUMBERS[word] : undefined;
  }
  // Each hint word pulls toward the numbers right after it; rare words ("15")
  // pull harder than words every candidate shares ("inch").
  const words = [...text.matchAll(/[\p{L}\d]+/gu)].map((m) => ({
    token: tokens(m[0]),
    at: m.index!,
  }));
  const pulls = words.flatMap(({ token, at }) =>
    [...token].filter((t) => hint.has(t)).map((t) => ({ t, at })),
  );
  const frequency = new Map<string, number>();
  for (const { t } of pulls) frequency.set(t, (frequency.get(t) ?? 0) + 1);
  let best = matches[0]!;
  let bestScore = -Infinity;
  for (const match of matches) {
    const at = match.index!;
    let score = match[0].includes("$") ? 0.2 : 0;
    for (const { t, at: where } of pulls) {
      if (where >= at && where < at + match[0].length) continue;
      const distance = where < at ? at - where : (where - at) * 3;
      score += Math.exp(-distance / 40) / frequency.get(t)!;
    }
    if (score > bestScore) [best, bestScore] = [match, score];
  }
  const unit = (best[1] ?? best[2])?.toLowerCase();
  const value = Number(best[0].replace(/[$,+]|\s?[a-z]+$/gi, "")) * (unit ? UNITS[unit]! : 1);
  return Number.isFinite(value) ? value : undefined;
}

function urlFor(view: DataView, node: OutlineNode): string | undefined {
  if (view.urlMap[node.id]) return view.urlMap[node.id];
  for (let i = node.index + 1; i < view.nodes.length && view.nodes[i]!.depth > node.depth; i++) {
    const url = view.urlMap[view.nodes[i]!.id];
    if (url) return url;
  }
  let current = node.parent === undefined ? undefined : view.nodes[node.parent];
  for (let hops = 0; current && hops < 3; hops++) {
    if (view.urlMap[current.id]) return view.urlMap[current.id];
    current = current.parent === undefined ? undefined : view.nodes[current.parent];
  }
  return undefined;
}

function convert(
  view: DataView,
  node: OutlineNode | undefined,
  field: Field,
  fromList = false,
): string | number | undefined {
  if (!node) return undefined;
  if (field.type === "url") return urlFor(view, node);
  if (field.type === "number" || field.type === "integer")
    return parseNumber(node.name, tokens(fieldText(field)));
  return stripLabel(node.name.replace(/\s+/g, " ").trim(), field, fromList);
}

function rankGroups(view: DataView, list: ListPlan, instruction: string): Group[] {
  const wanted = tokens(
    [instruction, list.name, list.description, ...list.fields.map(fieldText)].join(" "),
  );
  const ranked = view.groups
    .map((group) => {
      const rich = group.slots.filter((slot) => slot.coverage >= 0.5).length;
      const text = [
        ...group.slots.map((slot) => slot.label ?? ""),
        ...group.records.slice(0, 3).map((record) => recordText(view, record, 200)),
        group.context[0] ?? "",
      ].join(" ");
      const score =
        Math.sqrt(group.records.length) * Math.min(rich, 8) * (1 + overlap(wanted, tokens(text)));
      return { group, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ group }) => group);
  const shortlist = ranked.slice(0, 8);
  // A long manual can have thousands of paragraphs. Reserve a slot for a
  // complete label sequence whose heading matches the requested scalar list.
  if (list.scalarItems) {
    const matchingLabels = ranked.find(
      (group) =>
        group.role === "label" &&
        group.sections.some((heading) => {
          const label = tokens(heading);
          return label.size > 0 && overlap(wanted, label) === label.size;
        }),
    );
    if (matchingLabels && !shortlist.includes(matchingLabels))
      shortlist.splice(7, 1, matchingLabels);
  }
  return shortlist;
}

function groupSourceLabels(view: DataView, group: Group): string[] {
  const labels = new Set([group.context[0] ?? "", ...group.sections]);
  const tables = new Set<OutlineNode>();
  for (const record of group.records) {
    let parent = record.parent;
    while (parent !== undefined) {
      const node = view.nodes[parent]!;
      if (/^(table|grid|layouttable)$/i.test(node.role)) {
        tables.add(node);
        break;
      }
      parent = node.parent;
    }
  }
  for (const table of tables) {
    labels.add(table.name);
    const caption = view.children[table.index]!.map((index) => view.nodes[index]!).find((node) =>
      /^caption$/i.test(node.role),
    );
    if (caption) labels.add(recordText(view, caption, 140));
    // A table is often introduced by a short paragraph outside its container.
    let container = table;
    while (container.parent !== undefined) {
      const siblings = view.children[container.parent]!;
      const position = siblings.indexOf(container.index);
      if (position > 0) {
        const prior = view.nodes[siblings[position - 1]!]!;
        if (/^(paragraph|heading|statictext)$/i.test(prior.role))
          labels.add(recordText(view, prior, 140));
        break;
      }
      if (siblings.length !== 1) break;
      container = view.nodes[container.parent]!;
    }
  }
  return [...labels];
}

function schemaRankGroups(view: DataView, list: ListPlan, instruction: string): Group[] {
  const task = tokens([instruction, list.name, list.description].join(" "));
  const fields = list.fields.map((field) => ({ field, terms: tokens(fieldText(field)) }));
  const wanted = new Set([...task, ...fields.flatMap(({ terms }) => [...terms])]);
  return view.groups
    .map((group) => {
      const slots = group.slots
        .filter((slot) => slot.coverage >= 0.5)
        .map((slot) => ({
          slot,
          label: tokens(slot.label ?? ""),
          numeric:
            slot.samples.length > 0 &&
            slot.samples.every((value) => numberCandidates(value).length > 0),
        }));
      if (slots.length === 0) return { group, score: -Infinity };
      const scopeMatch = Math.max(
        0,
        ...groupSourceLabels(view, group).map((heading) => {
          const terms = tokens(heading);
          return overlap(task, terms) / Math.sqrt(Math.max(terms.size, 1));
        }),
      );
      const coverage =
        fields.reduce((sum, { field, terms }) => {
          let best = 0;
          for (const { slot, numeric, label } of slots) {
            if (!(field.type === "url" ? slot.link : field.type === "string" || numeric)) continue;
            const match = overlap(terms, label) / Math.sqrt(Math.max(label.size, 1));
            best = Math.max(best, slot.coverage * (1 + match));
          }
          return sum + best;
        }, 0) / Math.max(1, fields.length);
      const explicitRecord = /^(row|layouttablerow|term|listitem|label|article)$/.test(group.role);
      const sample = tokens(
        group.records
          .slice(0, 3)
          .map((record) => recordText(view, record, 150))
          .join(" "),
      );
      const score =
        3 * scopeMatch +
        4 * coverage +
        Number(explicitRecord) +
        0.35 * overlap(wanted, sample) +
        0.25 * Math.log1p(group.records.length);
      return { group, score };
    })
    .filter(({ score }) => Number.isFinite(score))
    .sort((a, b) => b.score - a.score)
    .map(({ group }) => group);
}

export function listGroupRanks(input: {
  schema: JsonSchema;
  instruction: string;
  tree: string;
  urlMap: Record<string, string>;
}) {
  const view = buildDataView(input.tree, input.urlMap);
  return plan(input.schema).lists.map((list) => ({
    list: list.name,
    groups: view.groups.map((group) => ({
      id: group.id,
      records: group.records.map((record) => record.id),
    })),
    baseline: rankGroups(view, list, input.instruction).map((group) => group.id),
    schema: schemaRankGroups(view, list, input.instruction).map((group) => group.id),
  }));
}

export type ListGroupExperiment =
  | "schema"
  | "choice"
  | "rich-choice"
  | "diverse-shortlist"
  | "retry-shortlist"
  | "selected-predicate"
  | { oracleGroup: string };

function describeGroup(view: DataView, group: Group): string {
  const where = group.sections.length
    ? ` in ${group.sections.length} sections (${clip(group.sections.filter(Boolean).slice(0, 3).join("; "), 80)})`
    : group.context[0]
      ? ` under "${clip(group.context[0], 50)}"`
      : "";
  const examples = group.records
    .slice(0, 2)
    .map((record, i) => `item ${i + 1}: ${recordText(view, record, 150)}`)
    .join(" / ");
  return `${group.records.length} items${where}. ${examples}`;
}

function rankSlots(slots: Slot[], field: Field): Slot[] {
  const wanted = tokens(fieldText(field));
  return slots
    .filter((slot) => (field.type === "url" ? slot.link : true))
    .map((slot) => ({
      slot,
      score:
        slot.coverage +
        overlap(wanted, tokens(`${slot.label ?? ""} ${slot.samples.join(" ")}`)) * 0.5,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 24)
    .map(({ slot }) => slot);
}

function describeSlot(slot: Slot, field?: Field): string {
  const samples = (field?.type === "url" ? slot.urlSamples : slot.samples)
    .map((sample) => `"${clip(sample, 90)}"`)
    .join(" | ");
  const sparse =
    slot.coverage < 0.5
      ? ` (only on ${Math.round(slot.coverage * 100)}% of items, applies to the items after it)`
      : "";
  return `${slot.label ? `column "${slot.label}", ` : ""}e.g. ${samples}${sparse}`;
}

function buildListMapping(view: DataView, list: ListPlan, instruction: string, group: Group) {
  const hasNumericField = list.fields.some(
    (field) => field.type === "number" || field.type === "integer",
  );
  const slotOptions = new Map(
    list.fields.map((field) => [
      field.name,
      rankSlots(group.slots, field).flatMap((slot) => {
        const whole = { slot, withoutPrefix: false, description: describeSlot(slot, field) };
        if (
          field.type !== "string" ||
          slot.samples.length < 2 ||
          !slot.samples.every(
            (sample) => textAfterNumericPrefix(sample, hasNumericField) !== undefined,
          )
        )
          return [whole];
        const samples = slot.samples.map((sample) =>
          textAfterNumericPrefix(sample, hasNumericField)!,
        );
        return [
          whole,
          {
            slot,
            withoutPrefix: true,
            description: `Text after the leading numeric identifier in the same label, ${describeSlot({ ...slot, samples }, field)}`,
          },
        ];
      }),
    ]),
  );
  const questions: Record<string, DecisionQuestion> = {};
  for (const field of list.fields) {
    const slots = slotOptions.get(field.name)!;
    questions[`f_${field.name}`] = {
      type: "choice",
      instructions: `Task: ${instruction}\nIn each item, which part holds "${fieldText(field)}"? Prefer the part that holds just this value, without extra text.`,
      criteria: {
        ...Object.fromEntries(slots.map((option, i) => [`s${i}`, option.description])),
        [NONE]: "Not present in the items",
      },
    };
  }
  const counts = countOptions(instruction);
  if (counts.length) {
    questions.count = {
      type: "choice",
      instructions: `Task: ${instruction}\nDoes the task ask for a fixed number of items? The page has ${group.records.length}.`,
      criteria: {
        ...Object.fromEntries(counts.map((n) => [`c${n}`, `Exactly ${n} items`])),
        all: "No fixed number: every item that matches the task",
      },
    };
  }
  const sections = [...new Set(group.context.filter(Boolean))];
  const bySection =
    sections.length >= 2 && sections.length <= Math.min(24, group.records.length / 2);
  questions.subset = {
    type: "noul",
    instructions: `Task: ${instruction}\nThe page has ${group.records.length} such items${bySection ? ` under these section labels: ${clip(sections.join("; "), 400)}` : ""}. Within this already selected group, does the task ask for only some of its items? A request for all items in this particular group does not ask for a subset just because other groups on the page should be excluded.`,
  };
  if (bySection) {
    const listing = clip(sections.map((section, i) => `${i + 1}. ${section}`).join("; "), 500);
    sections.forEach((section, i) => {
      questions[`sec${i}`] = {
        type: "noul",
        instructions: `Task: ${instruction}\nThe items are grouped under these section labels, in page order: ${listing}.\nShould the items under "${clip(section, 80)}" be included in the result?`,
      };
    });
    if (sections.length >= 3) {
      const options = Object.fromEntries(
        sections.map((section, i) => [`x${i}`, clip(section, 80)]),
      );
      for (const end of ["first", "last"] as const) {
        questions[`range_${end}`] = {
          type: "choice",
          instructions: `Task: ${instruction}\nThe items are grouped under these section labels, in page order: ${listing}.\nIf the task asks for a contiguous run of these sections (a range), which section is the ${end} one in that run?`,
          criteria: { ...options, [NONE]: "The task does not ask for a range of sections" },
        };
      }
    }
  }
  const preview = group.records.slice(0, 3).map((record) => recordText(view, record, 300));
  return { slotOptions, counts, sections, bySection, preview, questions, hasNumericField };
}

async function chooseListGroup(
  config: DecisionModelConfig,
  view: DataView,
  list: ListPlan,
  instruction: string,
  groups: Group[],
  trace: TraceEntry[],
  stopOnDisagreement: boolean,
  gate: "dual" | "choice" | "rich-choice" | "selected-predicate",
): Promise<Group | undefined> {
  const groupStarted = performance.now();
  const choiceOnly = gate === "choice" || gate === "rich-choice";
  const questions = listGroupQuestions(view, list, instruction, groups, gate === "rich-choice");
  const first = await ask(
    config,
    { task: instruction },
    choiceOnly ? { group: questions.group! } : questions,
  );
  trace.push({
    step: `${list.name}:group-ms`,
    choice: "group",
    confidence: Math.round(performance.now() - groupStarted),
    options: 0,
  });
  const picked = choiceOf(first.answers, "group", trace, `${list.name}:group`, groups.length + 1);
  const group = groups.find((candidate) => candidate.id === picked.choice);
  if (choiceOnly) return group;
  const pointwise = groups.map((candidate) => ({
    id: candidate.id,
    yes: noulOf(first.answers, `is_${candidate.id}`),
  }));
  const best = pointwise.toSorted((a, b) => b.yes - a.yes)[0];
  trace.push({
    step: `${list.name}:group-pointwise`,
    choice: best?.id ?? NONE,
    confidence: best?.yes ?? 0,
    options: groups.length,
  });
  const rejected =
    gate === "selected-predicate"
      ? group && noulOf(first.answers, `is_${group.id}`) < 0.5
      : gate === "dual" && best && group && (best.id !== group.id || best.yes < 0.5);
  if (rejected) {
    const reason = `group-disagree:${list.name}`;
    problem(trace, reason);
    if (stopOnDisagreement) throw new Error(reason);
  }
  return group;
}

function listGroupQuestions(
  view: DataView,
  list: ListPlan,
  instruction: string,
  groups: Group[],
  richer = false,
) {
  const want = list.fields.map(fieldText).join(", ");
  const listName = list.name.replaceAll("_", " ");
  const descriptions = groups.map((group) => {
    const description = describeGroup(view, group);
    if (!richer) return [group.id, description] as const;
    const labels = groupSourceLabels(view, group).filter(Boolean);
    const fields = [...new Set(group.slots.flatMap((slot) => (slot.label ? [slot.label] : [])))];
    return [
      group.id,
      `${description} Source labels: ${clip(labels.join(" | "), 140)}. Columns: ${clip(fields.join(" | "), 120)}.`,
    ] as const;
  });
  const questions: Record<string, DecisionQuestion> = {
    group: {
      type: "choice",
      instructions: `Task: ${instruction}\nWhich group of repeated page items is the "${listName}" list? Each item must provide: ${want}.`,
      criteria: { ...Object.fromEntries(descriptions), [NONE]: "None of these groups" },
    },
  };
  for (const [id, description] of descriptions) {
    questions[`is_${id}`] = {
      type: "noul",
      instructions: `Task: ${instruction}\nAre these repeated page items the "${listName}" list (each item provides: ${want})? ${description}`,
    };
  }
  return questions;
}

export function listGroupProbe(
  input: { schema: JsonSchema; instruction: string; tree: string; urlMap: Record<string, string> },
  {
    omit = [],
    reverse = false,
    richer = false,
  }: { omit?: string[]; reverse?: boolean; richer?: boolean } = {},
) {
  const view = buildDataView(input.tree, input.urlMap);
  return plan(input.schema).lists.map((list) => {
    const groups = rankGroups(view, list, input.instruction).filter(
      (group) => !omit.includes(group.id),
    );
    if (reverse) groups.reverse();
    return groups.length
      ? listGroupQuestions(view, list, input.instruction, groups, richer)
      : undefined;
  });
}

async function readList(
  config: DecisionModelConfig,
  view: DataView,
  list: ListPlan,
  instruction: string,
  trace: TraceEntry[],
  speculateListMapping: boolean,
  groupExperiment: ListGroupExperiment | undefined,
  stopOnDisagreement: boolean,
): Promise<unknown[] | undefined> {
  const groups =
    groupExperiment === "schema"
      ? schemaRankGroups(view, list, instruction).slice(0, 8)
      : rankGroups(view, list, instruction);
  const supplementaryGroups = () =>
    schemaRankGroups(view, list, instruction)
      .slice(0, 4)
      .filter((candidate) => !groups.includes(candidate));
  if (groups.length === 0 && typeof groupExperiment !== "object") return undefined;
  const candidate = groups[0]!;
  const speculative =
    speculateListMapping && candidate && typeof groupExperiment !== "object"
      ? (() => {
          const mapping = buildListMapping(view, list, instruction, candidate);
          return {
            mapping,
            response: ask(config, { task: instruction, items: mapping.preview }, mapping.questions),
          };
        })()
      : undefined;
  // The group answer can reject this candidate. Observe its failure immediately.
  void speculative?.response.catch(() => {});
  let group =
    typeof groupExperiment === "object"
      ? view.groups.find((candidate) => candidate.id === groupExperiment.oracleGroup)
      : await chooseListGroup(
          config,
          view,
          list,
          instruction,
          groupExperiment === "diverse-shortlist" ? [...groups, ...supplementaryGroups()] : groups,
          trace,
          stopOnDisagreement,
          groupExperiment === "choice" ||
            groupExperiment === "rich-choice" ||
            groupExperiment === "selected-predicate"
            ? groupExperiment
            : "dual",
        );
  if (!group && groupExperiment === "retry-shortlist") {
    const supplementary = supplementaryGroups();
    if (supplementary.length) {
      group = await chooseListGroup(
        config,
        view,
        list,
        instruction,
        supplementary,
        trace,
        stopOnDisagreement,
        "dual",
      );
    }
  }
  if (!group) return undefined;
  trace.push({
    step: `${list.name}:page-items`,
    choice: String(group.records.length),
    confidence: 0,
    options: 0,
  });

  const mappingStarted = performance.now();
  const reused = speculative && group === candidate ? speculative : undefined;
  const mappingRequest = reused?.mapping ?? buildListMapping(view, list, instruction, group);
  const { slotOptions, counts, sections, bySection, hasNumericField } = mappingRequest;
  const { answers } = await (reused?.response ??
    ask(config, { task: instruction, items: mappingRequest.preview }, mappingRequest.questions));
  trace.push({
    step: `${list.name}:mapping-ms`,
    choice: reused ? "speculative" : "sequential",
    confidence: Math.round(performance.now() - mappingStarted),
    options: 0,
  });

  const mapping = new Map<string, Slot | undefined>();
  const namesWithoutPrefix = new Set<string>();
  for (const field of list.fields) {
    const slots = slotOptions.get(field.name)!;
    const { choice } = choiceOf(
      answers,
      `f_${field.name}`,
      trace,
      `${list.name}.${field.name}`,
      slots.length + 1,
    );
    const option = choice === NONE ? undefined : slots[Number(choice.slice(1))];
    const linked = slots.filter((candidate) => candidate.slot.link);
    const slot =
      option?.slot ?? (field.type === "url" && linked.length === 1 ? linked[0]?.slot : undefined);
    mapping.set(field.name, slot);
    if (option?.withoutPrefix) namesWithoutPrefix.add(field.name);
  }
  if (list.fields.every((field) => !mapping.get(field.name))) return undefined;

  let records = group.records.map((record, index) => ({ record, index }));
  const countChoice = counts.length
    ? choiceOf(answers, "count", trace, `${list.name}:count`, counts.length + 1).choice
    : "all";
  const count = countChoice.startsWith("c") ? Number(countChoice.slice(1)) : undefined;
  const subset = count === undefined && noulOf(answers, "subset") > 0.5;
  trace.push({
    step: `${list.name}:subset`,
    choice: String(subset),
    confidence: noulOf(answers, "subset"),
    options: 2,
  });
  if (bySection) {
    const votes = sections.map((_, i) => noulOf(answers, `sec${i}`));
    trace.push({
      step: `${list.name}:section-votes`,
      choice: sections
        .map((section, i) => `${clip(section, 20)}=${votes[i]!.toFixed(2)}`)
        .join("|"),
      confidence: 0,
      options: sections.length,
    });
    const decisive = votes.some((vote) => vote >= 0.8) && votes.some((vote) => vote <= 0.2);
    if (subset || decisive) {
      const keep = new Set(sections.filter((_, i) => votes[i]! >= 0.5));
      if (sections.length >= 3) {
        const firstEnd = choiceOf(
          answers,
          "range_first",
          trace,
          `${list.name}:range_first`,
          sections.length + 1,
        ).choice;
        const lastEnd = choiceOf(
          answers,
          "range_last",
          trace,
          `${list.name}:range_last`,
          sections.length + 1,
        ).choice;
        if (firstEnd !== NONE && lastEnd !== NONE) {
          const from = Number(firstEnd.slice(1));
          const to = Number(lastEnd.slice(1));
          for (let i = Math.min(from, to); i <= Math.max(from, to); i++) keep.add(sections[i]!);
        }
      }
      trace.push({
        step: `${list.name}:sections`,
        choice: [...keep].join("|"),
        confidence: keep.size,
        options: sections.length,
      });
      if (keep.size > 0)
        records = records.filter(({ index }) => keep.has(group.context[index] ?? ""));
    }
  }
  if (count !== undefined) {
    // "The 10 most populous": a leading total or header-like row must not take a place.
    const window = records.slice(0, Math.min(records.length, count + 5));
    if (records.length > count) {
      const check = await ask(
        config,
        { task: instruction },
        Object.fromEntries(
          window.map(({ record, index }) => [
            `r${index}`,
            {
              type: "noul",
              instructions: `Task: ${instruction}\nIs this item one of the things the task asks for (not a total, summary or heading row)? Item: ${recordText(view, record, 220)}`,
            } satisfies DecisionQuestion,
          ]),
        ),
      );
      const kept = window.filter(({ index }) => noulOf(check.answers, `r${index}`) >= 0.5);
      if (kept.length >= count) records = kept;
    }
    if (records.length < count)
      problem(trace, `count-short:${list.name}:${records.length}/${count}`);
    records = records.slice(0, count);
  } else if (subset && !(bySection && records.length < group.records.length)) {
    const third = await ask(
      config,
      { task: instruction },
      Object.fromEntries(
        records.map(({ record, index }) => [
          `r${index}`,
          {
            type: "noul",
            instructions: `Task: ${instruction}\nThis record belongs to the already selected group, ${describeGroup(view, group)}. Judge inclusion based on the request within that group. Similar text elsewhere does not change this record's membership. Should this item be included? Item ${index + 1} of ${group.records.length}: ${recordText(view, record, 220)}`,
          } satisfies DecisionQuestion,
        ]),
      ),
    );
    trace.push({
      step: `${list.name}:filter`,
      choice: "subset",
      confidence: noulOf(answers, "subset"),
      options: records.length,
    });
    records = records.filter(({ index }) => noulOf(third.answers, `r${index}`) >= 0.5);
  }

  // A value holding several numbers ("829.8 m (2,722 ft)", "20 February 1991"):
  // the model says which position holds the field, read once from a sample.
  const position = new Map<string, number>();
  {
    const questionsN: Record<string, DecisionQuestion> = {};
    const samples = new Map<string, { value: number; shown: string }[]>();
    for (const field of list.fields) {
      const slot = mapping.get(field.name);
      if (!slot || (field.type !== "number" && field.type !== "integer")) continue;
      const texts = records
        .slice(0, 5)
        .map(({ record }) => readSlot(view, record, slot.key)?.name ?? "");
      const sample = texts.map(numberCandidates).find((candidates) => candidates.length >= 2);
      if (!sample || sample.length > 12) continue;
      samples.set(field.name, sample);
      questionsN[`n_${field.name}`] = {
        type: "choice",
        instructions: `Task: ${instruction}\nIn this item's value, which bracketed number is "${fieldText(field)}"?`,
        criteria: Object.fromEntries(sample.map((candidate, i) => [`p${i}`, candidate.shown])),
      };
    }
    if (Object.keys(questionsN).length) {
      const { answers } = await ask(config, { task: instruction }, questionsN);
      for (const name of samples.keys()) {
        const { choice } = choiceOf(
          answers,
          `n_${name}`,
          trace,
          `${list.name}.${name}:number`,
          samples.get(name)!.length,
        );
        if (choice.startsWith("p")) position.set(name, Number(choice.slice(1)));
      }
    }
  }

  const chosen = [...mapping.values()].filter((slot): slot is Slot => slot !== undefined);
  const urlSlots = new Set(
    list.fields.filter((field) => field.type === "url").map((field) => mapping.get(field.name)),
  );
  const missing = new Map<string, number>();
  const carried = new Map<string, string | number | undefined>();
  const carriedSources = new Map<string, string>();
  const items = records.map(({ record }) => {
    const item: Record<string, unknown> = {};
    for (const field of list.fields) {
      const slot = mapping.get(field.name);
      const inner = slot
        ? chosen.filter(
            (other) =>
              other !== slot &&
              !urlSlots.has(other) &&
              (slot.key === "." || other.key.startsWith(`${slot.key}/`)),
          )
        : [];
      let value =
        slot && namesWithoutPrefix.has(field.name)
          ? textAfterNumericPrefix(readSlot(view, record, slot.key)?.name ?? "", hasNumericField)
          : slot && inner.length && field.type === "string"
            ? residual(
                view,
                record,
                slot.key,
                inner.map((other) => other.key),
              )
            : slot
              ? position.has(field.name)
                ? (numberCandidates(readSlot(view, record, slot.key)?.name ?? "")[
                    position.get(field.name)!
                  ]?.value ?? convert(view, readSlot(view, record, slot.key), field, true))
                : convert(view, readSlot(view, record, slot.key), field, true)
              : undefined;
      let sourceId = slot ? readSlot(view, record, slot.key)?.id : undefined;
      if (slot && slot.coverage < 0.5 && !list.scalarItems) {
        if (value === undefined) {
          value = carried.get(field.name);
          sourceId = carriedSources.get(field.name);
        } else {
          carried.set(field.name, value);
          if (sourceId) carriedSources.set(field.name, sourceId);
        }
      }
      if (typeof value === "string" && field.type === "string") value = fitExample(value, field);
      if (value !== undefined) {
        item[field.name] = value;
        trace.push({
          step: `${list.name}.${field.name}:source`,
          choice: slot?.key ?? NONE,
          confidence: 1,
          options: 1,
          recordId: record.id,
          sourceIds: sourceId ? [sourceId] : [],
        });
      } else if (field.required && field.nullable) {
        item[field.name] = null;
      } else if (field.required) {
        missing.set(field.name, (missing.get(field.name) ?? 0) + 1);
      }
    }
    return list.scalarItems ? item[list.fields[0]!.name] : item;
  });
  for (const [field, count] of missing)
    problem(trace, `missing:${list.name}.${field}:${count}/${items.length}`);
  return items;
}

function textAfterNumericPrefix(label: string, allowBareInteger: boolean): string | undefined {
  const text = label.replace(/\s+/g, " ").trim();
  const section = /^\d+(?:\.\d+)*\.\s+(\p{L}.*)$/u.exec(text);
  if (section || !allowBareInteger) return section?.[1];
  return /^\d+\s+(\p{L}.*)$/u.exec(text)?.[1];
}

/**
 * The schema's own example ("For example, GG 12345") fixes the value's shape:
 * a copied "GG 51526 Notice 5533" keeps only the part with that shape.
 */
function fitExample(value: string, field: Field): string {
  const example = /(?:for example|e\.g\.?|such as)[,:]?\s*["']?([^"'.;]*\d[^"';]*?)["']?\s*$/i
    .exec(field.description)?.[1]
    ?.trim();
  if (!example) return value;
  const pattern = example
    .split(/(\p{L}+|\d+|\s+)/u)
    .filter(Boolean)
    .map((part) =>
      /^\p{L}+$/u.test(part)
        ? "\\p{L}+"
        : /^\d+$/.test(part)
          ? "\\d+"
          : /^\s+$/.test(part)
            ? "\\s+"
            : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("");
  const match = new RegExp(`(?<![\\p{L}\\d])${pattern}(?![\\p{L}\\d])`, "u").exec(value);
  return match && match[0] !== value ? match[0] : value;
}

/**
 * Text of `key` with the parts other fields already took removed, keeping the
 * longest remaining run of adjacent pieces (a card's address once its name and
 * phone are claimed).
 */
function residual(
  view: DataView,
  record: OutlineNode,
  key: string,
  claimedKeys: string[],
): string | undefined {
  const root = key === "." ? record : readSlot(view, record, key);
  if (!root) return undefined;
  const claimed = new Set(
    claimedKeys.map((other) => readSlot(view, record, other)?.index).filter((i) => i !== undefined),
  );
  const runs: string[][] = [[]];
  const walk = (index: number) => {
    const node = view.nodes[index]!;
    if (claimed.has(index)) {
      runs.push([]);
      return;
    }
    const kids = view.children[index] ?? [];
    if (!kids.length) {
      if (node.name.trim()) runs[runs.length - 1]!.push(node.name.trim());
      return;
    }
    for (const kid of kids) walk(kid);
  };
  walk(root.index);
  const best = runs
    .map((run) =>
      run
        .join(" ")
        .replace(/\s+([,.;:)])/g, "$1")
        .trim(),
    )
    .sort((a, b) => b.length - a.length)[0];
  return best || undefined;
}

function rankFacts(view: DataView, field: Field, instruction: string): Fact[] {
  const own = tokens(fieldText(field));
  const task = tokens(instruction);
  const numeric = field.type === "number" || field.type === "integer";
  const all = view.facts.filter((fact) =>
    field.type === "url" ? fact.url : numeric ? /\d/.test(fact.value) : true,
  );
  const main = all.filter((fact) => !fact.chrome);
  const usable = all;
  if (usable.length <= 40) return usable;
  const ranked = usable
    .map((fact) => {
      const label = tokens(fact.label);
      const value = tokens(fact.value);
      let score =
        3 * overlap(own, label) +
        2 * overlap(own, value) +
        0.5 * overlap(task, new Set([...label, ...value]));
      if ((field.type === "number" || field.type === "integer") && !/\d/.test(fact.value))
        score -= 2;
      if (fact.chrome) score *= 0.7;
      return { fact, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);
  const weak = (ranked[0]?.score ?? 0) < 3;
  const top = ranked.slice(0, weak ? 30 : 22).map(({ fact }) => fact);
  // Values often carry no words of the field ("Coframe" for a company name):
  // add the neighbours of the best label matches.
  const limit = weak ? 60 : 30;
  const picked = new Set(top);
  for (const anchor of top.slice(0, 4)) {
    const at = usable.indexOf(anchor);
    for (const neighbour of usable.slice(Math.max(0, at - 2), at + 3)) {
      if (picked.size >= limit) break;
      picked.add(neighbour);
    }
  }
  // Nothing on the page shares the field's words: let the model read the main content.
  for (const fact of usable) {
    if (picked.size >= limit) break;
    if (weak && (!fact.chrome || main.length < 5)) picked.add(fact);
  }
  return [...picked];
}

function stripLabel(text: string, field: Field, fromList = false): string {
  // An unspaced colon in a list value can be part of an identifier.
  const prefix = fromList ? /^([^:]{1,40}):\s+(.+)$/s : /^([^:]{1,40}):\s*(.+)$/s;
  const match = prefix.exec(text);
  if (!match) return text;
  const label = match[1]!.trim();
  if (overlap(tokens(label), tokens(fieldText(field))) > 0 || label.split(/\s+/).length <= 3)
    return match[2]!.trim();
  return text;
}

function valueFromFact(fact: Fact, field: Field) {
  return field.type === "url"
    ? fact.url
    : field.type === "string"
      ? stripLabel(fact.value.replace(/\s+/g, " ").trim(), field)
      : parseNumber(fact.value, tokens(fieldText(field)));
}

async function readScalars(
  config: DecisionModelConfig,
  view: DataView,
  fields: Field[],
  instruction: string,
  trace: TraceEntry[],
  reader?: ScalarReader,
  checkOnly = false,
): Promise<Record<string, unknown>> {
  const options = new Map(fields.map((field) => [field.name, rankFacts(view, field, instruction)]));
  const questions: Record<string, DecisionQuestion> = {};
  for (const field of fields) {
    const facts = options.get(field.name)!;
    if (facts.length === 0) continue;
    questions[`f_${field.name}`] = {
      type: "choice",
      instructions: `Task: ${instruction}\nWhich page text holds "${fieldText(field)}"?`,
      criteria: {
        ...Object.fromEntries(
          facts.map((fact, i) => {
            return [
              `t${i}`,
              `${fact.label ? `[${clip(fact.label, 90)}] ` : ""}${clip(fact.value, 180)}`,
            ];
          }),
        ),
        [NONE]: "None of these",
      },
    };
  }
  for (const field of fields) {
    if (field.required || !questions[`f_${field.name}`]) continue;
    const choice = questions[`f_${field.name}`];
    if (choice?.type !== "choice") continue;
    questions[`present_${field.name}`] = {
      type: "noul",
      instructions: `Task: ${instruction}\nDoes any candidate explicitly state the value of "${fieldText(field)}" as that particular fact? A related number in a name or another field is insufficient. Candidates: ${JSON.stringify(choice.criteria)}`,
    };
  }
  // Values that live in one item of a repeated group (a table row, a card) are
  // better read as a record: pick the item, then the part per field.
  const pseudo: ListPlan = {
    name: "item",
    description: "",
    fields,
    scalarItems: false,
    required: true,
  };
  const groups =
    fields.length > 1 || view.groups.length
      ? rankGroups(view, pseudo, instruction).slice(0, 6)
      : [];
  if (groups.length) {
    questions.record_group = {
      type: "choice",
      instructions: `Task: ${instruction}\nAre ALL the requested values (${fields.map(fieldText).join(", ")}) inside ONE single item of one of these repeated groups? If so, which group?`,
      criteria: {
        ...Object.fromEntries(groups.map((group) => [group.id, describeGroup(view, group)])),
        [NONE]: "No: the values are not all inside one item of a repeated group",
      },
    };
  }
  const readerTrace: TraceEntry[] = [];
  const [answers, read] = await Promise.all([
    Object.keys(questions).length
      ? ask(config, { task: instruction }, questions).then((result) => result.answers)
      : {},
    reader ? readFromSheet(reader, view, fields, instruction, options, readerTrace) : {},
  ]);

  const data: Record<string, unknown> = {};
  const ambiguous: Record<string, DecisionQuestion> = {};
  const candidatesFor = new Map<string, { value: number; shown: string }[]>();
  for (const field of fields) {
    const facts = options.get(field.name)!;
    const { choice } = choiceOf(answers, `f_${field.name}`, trace, field.name, facts.length + 1);
    const fact = choice === NONE ? undefined : facts[Number(choice.slice(1))];
    if (!fact) continue;
    const numeric = field.type === "number" || field.type === "integer";
    const candidates = numeric ? numberCandidates(fact.value) : [];
    if (candidates.length >= 2 && candidates.length <= 16) {
      candidatesFor.set(field.name, candidates);
      ambiguous[`n_${field.name}`] = {
        type: "choice",
        instructions: `Task: ${instruction}\nWhich bracketed number is "${fieldText(field)}"?`,
        criteria: Object.fromEntries(candidates.map((candidate, i) => [`p${i}`, candidate.shown])),
      };
    }
    const value = valueFromFact(fact, field);
    if (value !== undefined) {
      data[field.name] = value;
      trace.push({
        step: `${field.name}:source`,
        choice: fact.id,
        confidence: 1,
        options: 1,
        sourceIds: [fact.id],
      });
    }
  }
  if (Object.keys(ambiguous).length) {
    const resolved = (await ask(config, { task: instruction }, ambiguous)).answers;
    for (const [name, candidates] of candidatesFor) {
      const { choice } = choiceOf(
        resolved,
        `n_${name}`,
        trace,
        `${name}:number`,
        candidates.length,
      );
      if (choice.startsWith("p")) data[name] = candidates[Number(choice.slice(1))]!.value;
    }
  }

  if (groups.length) {
    const picked = choiceOf(answers, "record_group", trace, "record_group", groups.length + 1);
    const group = groups.find((candidate) => candidate.id === picked.choice);
    if (group) {
      const record = await readRecord(config, view, group, fields, instruction, trace);
      if (record) Object.assign(data, record);
    }
  }

  if (reader) {
    trace.push(...readerTrace);
    if (!checkOnly) Object.assign(data, read);
    else {
      // A second reading of the same values: fill gaps, flag disagreements.
      for (const [name, value] of Object.entries(read)) {
        const mine = data[name];
        if (mine === undefined || mine === "") data[name] = value;
        else if (!sameValue(mine, value)) problem(trace, `scalar-disagree:${name}`);
      }
    }
  }

  for (const field of fields) {
    const presence = answers[`present_${field.name}`];
    if (
      !field.required &&
      data[field.name] !== undefined &&
      presence?.type === "noul" &&
      presence.noul < 0.5
    ) {
      delete data[field.name];
    }
  }

  for (const field of fields) {
    if (data[field.name] !== undefined || !field.required) continue;
    if (field.nullable) data[field.name] = null;
    else throw new Error(`unresolved:${field.name}`);
  }
  return data;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  const normal = (value: unknown) => String(value).toLowerCase().replace(/\s+/g, " ").trim();
  const [x, y] = [normal(a), normal(b)];
  return x === y;
}

/**
 * The candidate facts of every field, one "label: value" line each in page
 * order, read by a span/field extractor. A value counts only if it occurs in
 * the sheet, so the reader cannot invent one.
 */
async function readFromSheet(
  reader: ScalarReader,
  view: DataView,
  fields: Field[],
  instruction: string,
  options: Map<string, Fact[]>,
  trace: TraceEntry[],
): Promise<Record<string, unknown>> {
  const facts = [...new Set(fields.flatMap((field) => options.get(field.name) ?? []))].sort(
    (a, b) => a.node.index - b.node.index,
  );
  if (!facts.length) return {};
  const sheet = facts
    .map((fact) => `${fact.label ? `${clip(fact.label, 90)}: ` : ""}${clip(fact.value, 300)}`)
    .join("\n");
  const scalarFields = fields.filter((field) => field.type !== "url");
  if (!scalarFields.length) return {};
  const answers = await reader({
    sheet,
    fields: scalarFields.map((field) => ({
      name: field.name,
      type: field.type === "string" ? "string" : "number",
      instructions: `${instruction}\nFind the exact value for ${fieldText(field)}.`,
    })),
  });
  const normal = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
  const data: Record<string, unknown> = {};
  for (const field of scalarFields) {
    const raw = answers[field.name];
    if (raw === null || raw === undefined || raw === "") continue;
    const sources = facts.filter((fact) =>
      typeof raw === "number"
        ? numberCandidates(fact.value).some((candidate) => candidate.value === raw)
        : normal(fact.value).includes(normal(raw)),
    );
    if (!sources.length) continue;
    const value =
      field.type === "string"
        ? String(raw).trim()
        : typeof raw === "number"
          ? raw
          : parseNumber(raw, tokens(fieldText(field)));
    if (value === undefined) continue;
    data[field.name] = value;
    trace.push({
      step: `${field.name}:reader`,
      choice: clip(String(value), 40),
      confidence: 1,
      options: facts.length,
      sourceIds: sources.map((fact) => fact.id),
    });
  }
  return data;
}

async function readRecord(
  config: DecisionModelConfig,
  view: DataView,
  group: Group,
  fields: Field[],
  instruction: string,
  trace: TraceEntry[],
): Promise<Record<string, unknown> | undefined> {
  const wanted = tokens(instruction);
  const candidates = group.records
    .map((record, index) => ({
      record,
      index,
      score: overlap(
        wanted,
        tokens(`${group.context[index] ?? ""} ${recordText(view, record, 300)}`),
      ),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 40);
  const slotOptions = new Map(fields.map((field) => [field.name, rankSlots(group.slots, field)]));
  const questions: Record<string, DecisionQuestion> = {
    record: {
      type: "choice",
      instructions: `Task: ${instruction}\nWhich single item holds the requested values?`,
      criteria: {
        ...Object.fromEntries(
          candidates.map(({ record, index }) => [
            `r${index}`,
            `${group.context[index] ? `[${clip(group.context[index]!, 50)}] ` : ""}${recordText(view, record, 200)}`,
          ]),
        ),
        [NONE]: "None of these items",
      },
    },
  };
  for (const field of fields) {
    questions[`f_${field.name}`] = {
      type: "choice",
      instructions: `Task: ${instruction}\nIn each item, which part holds "${fieldText(field)}"? Prefer the part that holds just this value, without extra text.`,
      criteria: {
        ...Object.fromEntries(
          slotOptions.get(field.name)!.map((slot, i) => [`s${i}`, describeSlot(slot, field)]),
        ),
        [NONE]: "Not present in the items",
      },
    };
  }
  const { answers } = await ask(
    config,
    {
      task: instruction,
      items: candidates.slice(0, 3).map(({ record }) => recordText(view, record, 300)),
    },
    questions,
  );
  const pickedRecord = choiceOf(answers, "record", trace, "record", candidates.length + 1);
  const record = group.records[Number(pickedRecord.choice.slice(1))];
  if (!record || pickedRecord.choice === NONE) return undefined;
  const values: Record<string, unknown> = {};
  const usedSlots = new Set<string>();
  for (const field of fields) {
    const slots = slotOptions.get(field.name)!;
    const { choice } = choiceOf(
      answers,
      `f_${field.name}`,
      trace,
      `record.${field.name}`,
      slots.length + 1,
    );
    const slot = choice === NONE ? undefined : slots[Number(choice.slice(1))];
    if (!slot) continue;
    // Two fields read from the same part means the values are not one item's columns.
    if (usedSlots.has(slot.key)) return undefined;
    usedSlots.add(slot.key);
    const value = convert(view, readSlot(view, record, slot.key), field);
    if (value !== undefined) {
      values[field.name] = value;
      const source = readSlot(view, record, slot.key);
      trace.push({
        step: `${field.name}:source`,
        choice: slot.key,
        confidence: 1,
        options: 1,
        recordId: record.id,
        sourceIds: source ? [source.id] : [],
      });
    }
  }
  return values;
}

export async function mapCopyExtract(
  config: DecisionModelConfig,
  {
    instruction,
    schema,
    tree,
    urlMap,
    trace = [],
    reader,
    readerChecks = false,
    verify = false,
    askVerifier = verify,
    speculateListMapping = false,
    groupExperiment,
  }: {
    instruction: string;
    schema: JsonSchema;
    tree: string;
    urlMap: Record<string, string>;
    trace?: TraceEntry[];
    reader?: ScalarReader;
    /** Use the reader as a second reading that flags disagreements, not as the answer. */
    readerChecks?: boolean;
    verify?: boolean;
    askVerifier?: boolean;
    speculateListMapping?: boolean;
    groupExperiment?: ListGroupExperiment;
  },
): Promise<{ data: Record<string, unknown>; trace: TraceEntry[]; verdict?: Verdict }> {
  const { lists, scalars } = plan(schema);
  const view = buildDataView(tree, urlMap);
  // With one list and no other work in flight, a rejected group can fall back immediately.
  const stopOnDisagreement =
    verify && !askVerifier && !speculateListMapping && lists.length === 1 && scalars.length === 0;
  const [scalarData, listData] = await Promise.all([
    scalars.length
      ? readScalars(config, view, scalars, instruction, trace, reader, readerChecks)
      : Promise.resolve({}),
    Promise.all(
      lists.map((list) =>
        readList(
          config,
          view,
          list,
          instruction,
          trace,
          speculateListMapping,
          groupExperiment,
          stopOnDisagreement,
        ),
      ),
    ),
  ]);
  const data: Record<string, unknown> = { ...scalarData };
  lists.forEach((list, index) => {
    const items = listData[index];
    if (items === undefined) {
      if (list.required) throw new Error(`unresolved:${list.name}`);
      return;
    }
    data[list.name] = items;
  });
  const problems = structuralProblems({ lists, scalars }, data, trace);
  const agree = askVerifier
    ? await verifyResult(config, instruction, lists, data, trace, problems)
    : 0;
  const verdict = verify ? { problems, agree } : undefined;
  return { data, trace, verdict };
}

export type Verdict = { problems: string[]; agree: number };

function structuralProblems(
  { lists, scalars }: ReturnType<typeof plan>,
  data: Record<string, unknown>,
  trace: TraceEntry[],
): string[] {
  const problems = trace.filter((entry) => entry.step === "problem").map((entry) => entry.choice);
  for (const field of scalars) {
    const value = data[field.name];
    if (
      field.required &&
      (value === undefined || value === "" || (value === null && !field.nullable))
    )
      problems.push(`empty:${field.name}`);
  }
  for (const list of lists) {
    const items = (data[list.name] ?? []) as unknown[];
    if (!items.length) problems.push(`empty:${list.name}`);
    if (!list.scalarItems && items.length) {
      for (const field of list.fields) {
        const missing = items.filter((item) => {
          const value = (item as Record<string, unknown>)[field.name];
          return value === "" || (value === null && !field.nullable) || value === undefined;
        }).length;
        if (field.required && missing / items.length > 0.5)
          problems.push(`mostly-empty:${list.name}.${field.name}`);
      }
    }
  }
  return problems;
}

async function verifyResult(
  config: DecisionModelConfig,
  instruction: string,
  lists: ListPlan[],
  data: Record<string, unknown>,
  trace: TraceEntry[],
  problems: string[],
): Promise<number> {
  const evidence = lists.map((list) => {
    const items = (data[list.name] ?? []) as unknown[];
    const pageItems = trace.find((entry) => entry.step === `${list.name}:page-items`)?.choice;
    return `${list.name}: returned ${items.length}${pageItems ? ` of the ${pageItems} items in the page list it was copied from` : " items"}`;
  });
  const preview = JSON.stringify(data, (_, value) =>
    Array.isArray(value) && value.length > 6
      ? [...value.slice(0, 4), `… ${value.length - 5} more …`, value.at(-1)]
      : value,
  );
  const { answers } = await ask(
    config,
    { task: instruction, result: clip(preview, 1500), notes: evidence.join("; ") },
    {
      ok: {
        type: "noul",
        instructions: `Task: ${instruction}\nIs this extracted result a correct and complete answer to the task (right items, right values, nothing extra)?`,
      },
    },
  );
  const agree = noulOf(answers, "ok");
  trace.push({ step: "verify", choice: problems.join("|") || "ok", confidence: agree, options: 2 });
  return agree;
}
