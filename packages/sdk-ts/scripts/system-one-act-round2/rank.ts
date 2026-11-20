import {
  candidates,
  type ActionSnapshot,
} from "../../../extension/services/decisions/actionPlans.ts";
import {
  describeCandidate,
  scoreCandidates,
  type OutlineNode,
} from "../../../extension/services/decisions/tree.ts";

export type CandidateKind = "pointer" | "input";
export type Ranking = "baseline" | "aliases" | "context" | "repeated-navigation";

const stop = new Set(
  (
    "the a an to of in on into onto for and or at by from with that this it is be as then all both every " +
    "click press tap type enter fill select choose find pick open close check uncheck toggle show " +
    "button link field box input dropdown menu option tab page item element icon please " +
    "section heading article list body prose paragraph listed under using"
  ).split(" "),
);

function words(value: string) {
  return (
    value
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  )
    .map((word) => word.replace(/^(\d+)(st|nd|rd|th)$/, "$1"))
    .map((word) => (word.length > 3 ? word.replace(/s$/, "") : word))
    .filter((word) => (word.length > 1 || /\d/.test(word)) && !stop.has(word));
}

export function physicalPath(xpath: string | undefined) {
  return xpath?.replace(/\/text\(\)(?:\[\d+\])?$/u, "");
}

// Node IDs are frame-scoped. Two same-origin frames can have identical XPaths.
export function physicalKey(snapshot: ActionSnapshot, id: string) {
  const path = physicalPath(snapshot.xpathMap[id]);
  return path ? JSON.stringify([id.split("-")[0], path]) : id;
}

type Section = { node: OutlineNode; level: number };
type Context = { headings: string[]; nearby?: string; placement: string[]; titleLink: boolean };

function parentPath(path: string) {
  return path.slice(0, path.lastIndexOf("/"));
}

function scopedContexts(snapshot: ActionSnapshot, nodes: OutlineNode[]) {
  const byScope = new Map<string, Section[]>();
  const records = new Map<string, string>();
  const filePath = (node: OutlineNode) => physicalPath(snapshot.xpathMap[node.id]) ?? "";
  const scopeKey = (node: OutlineNode, path: string) => `${node.id.split("-")[0]}\u0000${path}`;
  for (const node of nodes) {
    const path = filePath(node);
    const tag = /\/h([1-6])\[\d+\]$/u.exec(path);
    if (tag && node.name && /\bheading\b/i.test(node.role)) {
      // A header wrapping the title is part of its enclosing section.
      const parent = parentPath(path).replace(/\/header\[\d+\]$/u, "");
      const key = scopeKey(node, parent);
      const sections = byScope.get(key) ?? [];
      sections.push({ node, level: Number(tag[1]) });
      byScope.set(key, sections);
    }
    const text = snapshot.facts[node.id]?.text;
    if (text && /\/(?:p|dd|tr|li|fieldset)\[\d+\]$/u.test(path)) {
      records.set(scopeKey(node, path), text);
    }
  }
  return (node: OutlineNode): Context => {
    const path = filePath(node);
    const placement: string[] = [];
    const sections: Section[] = [];
    let nearby: string | undefined;
    for (let at = path; at; at = parentPath(at)) {
      const key = scopeKey(node, at);
      nearby ??= records.get(key);
      const tag = /\/([a-z]+)\[\d+\]$/u.exec(at)?.[1];
      if (tag && ["nav", "aside", "main", "footer", "header", "article"].includes(tag))
        placement.push(tag);
      for (const section of byScope.get(key) ?? []) {
        if (section.node.index < node.index) sections.push(section);
        else break;
      }
      // A heading from the main text should never become evidence for its navigation or sidebar.
      if (tag && ["nav", "aside", "footer"].includes(tag)) break;
    }
    const chain: Section[] = [];
    for (const section of sections.sort((a, b) => a.node.index - b.node.index)) {
      while (chain.length && chain.at(-1)!.level >= section.level) chain.pop();
      chain.push(section);
    }
    const titleLink =
      /\blink\b/i.test(node.role) &&
      (/\/h[1-6]\[\d+\]\/a\[\d+\]$/u.test(path) ||
        nodes.slice(node.index + 1, node.index + 8).some((child) => {
          const childPath = filePath(child);
          return /\/h[1-6]\[\d+\]$/u.test(childPath) && childPath.startsWith(`${path}/`);
        }));
    return {
      headings: chain.map(({ node: heading }) => heading.name.slice(0, 100)),
      nearby: nearby && nearby !== snapshot.facts[node.id]?.text ? nearby : undefined,
      placement,
      titleLink,
    };
  };
}

function rankContext(
  snapshot: ActionSnapshot,
  nodes: OutlineNode[],
  eligible: OutlineNode[],
  instruction: string,
  kind: CandidateKind,
) {
  const contextOf = scopedContexts(snapshot, nodes);
  const wanted = new Set(words(instruction));
  const wantsLink = /\blinks?\b/i.test(instruction);
  const wantsTitleLink = /\btitle links?\b/i.test(instruction);
  const wantsButton = /\bbuttons?\b/i.test(instruction);
  const contexts = new Map<string, Context>();
  const scores = new Map<string, number>();
  for (const node of eligible) {
    const fact = snapshot.facts[node.id]!;
    const description = describeCandidate(nodes, node);
    const context = contextOf(node);
    contexts.set(node.id, context);
    const weights = new Map<string, number>();
    const match = (values: string, weight: number) => {
      for (const word of words(values)) {
        if (wanted.has(word)) weights.set(word, Math.max(weights.get(word) ?? 0, weight));
      }
    };
    match(node.name || fact.name || fact.text, 4);
    match(fact.title ?? "", 4);
    // Keep the slug separate from the domain and query string. Shared site terms
    // or a query parameter do not identify the control.
    match(
      fact.href?.split(/[?#]/u, 1)[0]?.split("/").filter(Boolean).slice(-2).join(" ") ?? "",
      0.5,
    );
    match(context.headings.join(" "), 2.5);
    match(context.nearby || fact.context, 1);
    match(
      [description.within, description.table]
        .flat()
        .map((value) =>
          typeof value === "object" && value !== null
            ? Object.values(value)
                .filter((part) => typeof part === "string")
                .join(" ")
            : String(value ?? ""),
        )
        .join(" "),
      1,
    );
    const role = node.role.toLowerCase().split(/[\s,]+/);
    const roleWeight =
      kind === "pointer" &&
      ((wantsLink && role.includes("link")) || (wantsButton && role.includes("button")))
        ? 2
        : 0;
    const placement =
      (/\b(?:side\s*bar|aside)\b/i.test(instruction) && context.placement.includes("aside")) ||
      (/\b(?:navigation|table of contents)\b/i.test(instruction) &&
        context.placement.includes("nav")) ||
      (/\bmain\b/i.test(instruction) &&
        context.placement.includes("main") &&
        !context.placement.includes("nav"));
    scores.set(
      node.id,
      [...weights.values()].reduce((total, weight) => total + weight, 0) +
        roleWeight +
        (wantsTitleLink && context.titleLink ? 4 : 0) +
        (placement ? 2 : 0),
    );
  }
  return { scores, contexts };
}

function prioritizeDistinct(snapshot: ActionSnapshot, ranked: OutlineNode[]) {
  const seen = new Set<string>();
  const distinct: OutlineNode[] = [];
  const aliases: OutlineNode[] = [];
  for (const node of ranked) {
    const key = physicalKey(snapshot, node.id);
    (seen.has(key) ? aliases : distinct).push(node);
    seen.add(key);
  }
  return distinct.concat(aliases);
}

function deferRepeatedNavigation(
  snapshot: ActionSnapshot,
  nodes: OutlineNode[],
  ranked: OutlineNode[],
  instruction: string,
) {
  if (
    /\b(?:navigation|sidebar|aside|header|footer|main|first|second|third|last|top|bottom|primary|secondary|\d+(?:st|nd|rd|th))\b/i.test(
      instruction,
    )
  )
    return ranked;
  const wanted = new Set(words(instruction));
  const seen = new Set<string>();
  const later: OutlineNode[] = [];
  const first = ranked.filter((node) => {
    const href = snapshot.facts[node.id]?.href;
    if (
      !href ||
      !node.name ||
      !/\blink\b/i.test(node.role) ||
      words(node.name).some((word) => wanted.has(word))
    )
      return true;
    for (let i = node.parent; i !== undefined; i = nodes[i]!.parent) {
      const ancestor = nodes[i]!;
      if (!/\bnavigation\b/i.test(ancestor.role)) continue;
      if (!ancestor.name) return true;
      const key = JSON.stringify([node.id.split("-")[0], ancestor.name, node.name, href]);
      if (seen.has(key)) {
        later.push(node);
        return false;
      }
      seen.add(key);
      break;
    }
    return true;
  });
  return first.concat(later);
}

export function rank(
  snapshot: ActionSnapshot,
  instruction: string,
  kind: CandidateKind,
  ranking: Ranking,
  limit = 30,
) {
  const { nodes, eligible, selected: baseline } = candidates(snapshot, instruction, kind);
  const { scores, contexts } =
    ranking === "context" || ranking === "repeated-navigation"
      ? rankContext(snapshot, nodes, eligible, instruction, kind)
      : {
          scores: scoreCandidates(nodes, eligible, instruction),
          contexts: new Map<string, Context>(),
        };
  const scored = eligible.toSorted(
    (a, b) => scores.get(b.id)! - scores.get(a.id)! || a.index - b.index,
  );
  const distinct =
    ranking === "baseline" || eligible.length <= limit
      ? scored
      : prioritizeDistinct(snapshot, scored);
  const ranked =
    ranking === "repeated-navigation" && kind === "pointer" && eligible.length > limit
      ? deferRepeatedNavigation(snapshot, nodes, distinct, instruction)
      : distinct;
  const selected = ranked.slice(0, limit).sort((a, b) => a.index - b.index);
  return { nodes, ranked, selected, baseline, contexts };
}
