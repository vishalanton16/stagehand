import {
  observationView,
  type ObservationCandidate,
  type ObservationSnapshot,
} from "./observeCandidates.js";
import { parseOutline } from "./outline.js";

const SECTION_REQUEST =
  /^find all (text )?links in the (?:"([^"\r\n]+)"|“([^“”\r\n]+)”|([^"“”\r\n]+)) section\.?$/iu;
const ELEMENT_PATH = /^(?:\/[a-z][\w-]*(?:\[\d+\])?)+$/u;
const TAG = /\/([a-z][\w-]*)(?:\[\d+\])?$/u;
const CHROME = /\/(?:nav|aside|header|footer)(?:\[\d+\])?(?:\/|$)/u;
const LANDMARK = /^(?:navigation|complementary|banner|contentinfo)$/u;
const HEADING = /^h([1-6])$/u;

type SectionRequest = { heading: string; textOnly: boolean };

function normalize(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}

export function parseObservationSection(
  instruction: string | undefined,
): SectionRequest | undefined {
  const match = SECTION_REQUEST.exec(instruction?.trim() ?? "");
  if (!match) return undefined;
  return { heading: normalize(match[2] ?? match[3] ?? match[4]!), textOnly: Boolean(match[1]) };
}

export function resolveObservationSection(
  snapshot: ObservationSnapshot,
  request: SectionRequest,
  view = observationView(snapshot),
): ObservationCandidate[] | undefined {
  if (!request.heading || /%[^%\s]+%/u.test(request.heading) || view.unresolved.length)
    return undefined;

  const nodes = parseOutline(snapshot.formattedTree);
  const headings = nodes.filter(
    (node) => node.role === "heading" && normalize(node.name) === request.heading,
  );
  const heading = headings[0];
  if (headings.length !== 1 || !heading) return undefined;

  const { xpathMap, facts } = snapshot;
  const headingPath = xpathMap[heading.id];
  const fact = facts[heading.id];
  if (!headingPath || !ELEMENT_PATH.test(headingPath) || CHROME.test(headingPath)) return undefined;
  const level = Number(HEADING.exec(fact?.tag ?? "")?.[1]);
  if (
    !level ||
    !fact?.visible ||
    fact.text.length >= 160 ||
    normalize(fact.text) !== request.heading ||
    TAG.exec(headingPath)?.[1] !== fact.tag
  )
    return undefined;

  const parentPath = headingPath.slice(0, headingPath.lastIndexOf("/"));
  const parent = heading.parent === undefined ? undefined : nodes[heading.parent];
  if (!parent || xpathMap[parent.id] !== parentPath) return undefined;
  const outlineEnd =
    nodes.find((node) => node.index > heading.index && node.depth <= parent.depth)?.index ??
    nodes.length;

  // The DOM map is emitted in depth-first document order. Per-tag XPath indices cannot
  // order unlike siblings, and accessibility order can omit or reparent DOM nodes.
  const entries = Object.entries(xpathMap);
  const frame = heading.id.split("-")[0];
  const start = entries.findIndex(([id]) => id === heading.id);
  if (start < 0 || entries.some(([id]) => id.split("-")[0] !== frame)) return undefined;

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  if (nodesById.size !== nodes.length) return undefined;
  const candidatesById = new Map(
    view.candidates.map((candidate) => [candidate.node.id, candidate]),
  );
  const links: ObservationCandidate[] = [];
  let previous = heading.index;
  for (let index = start + 1; index < entries.length; index++) {
    const [id, path] = entries[index]!;
    if (!path.startsWith(`${parentPath}/`)) break;
    if (CHROME.test(path)) continue;
    if (path.includes("//")) return undefined;

    const node = nodesById.get(id);
    const tag = TAG.exec(path)?.[1] ?? "";
    if (tag === "iframe" || tag === "frame" || LANDMARK.test(node?.role ?? "")) return undefined;
    const headingLevel = Number(HEADING.exec(tag)?.[1]);
    if (headingLevel || node?.role === "heading") {
      const boundary = facts[id];
      if (boundary?.visible === false) continue;
      if (!boundary || boundary.tag !== tag || !headingLevel || node?.role !== "heading")
        return undefined;
      if (node.index <= previous || node.index >= outlineEnd) return undefined;
      if (headingLevel <= level) {
        // A heading inside another container may label links that precede the heading.
        if (path.slice(0, path.lastIndexOf("/")) !== parentPath) return undefined;
        break;
      }
      previous = node.index;
      continue;
    }
    if (tag !== "a" && node?.role !== "link") continue;

    const link = facts[id];
    // Empty title anchors without an AX node or URL can be fragment markers.
    if (
      path.startsWith(`${headingPath}/`) &&
      !node &&
      !link &&
      !snapshot.urlMap[id] &&
      !entries[index + 1]?.[1].startsWith(`${path}/`)
    )
      continue;
    if (link?.visible === false || (link?.tag === "a" && !link.href && node?.role !== "link"))
      continue;
    const candidate = candidatesById.get(id);
    if (
      !candidate ||
      !ELEMENT_PATH.test(path) ||
      candidate.fact.tag !== "a" ||
      !candidate.fact.href ||
      node?.role !== "link" ||
      node.index <= previous ||
      node.index >= outlineEnd
    )
      return undefined;
    previous = node.index;
    if (request.textOnly) {
      if (!candidate.fact.text.trim()) continue;
      // textContent on a mixed-content anchor can include visually hidden labels.
      for (let child = index + 1; entries[child]?.[1].startsWith(`${path}/`); child++) {
        if (ELEMENT_PATH.test(entries[child]![1])) return undefined;
      }
    }
    links.push(candidate);
  }
  return links.length ? links : undefined;
}
