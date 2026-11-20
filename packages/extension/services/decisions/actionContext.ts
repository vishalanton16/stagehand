import type { ActionSnapshot } from "./actionPlans.js";
import type { OutlineNode } from "./tree.js";

const ELEMENT_PATH = /^(?:\/[a-z][\w-]*(?:\[\d+\])?)+$/u;
const HEADING = /\/h([1-6])(?:\[\d+\])?$/u;
const LANDMARK = /\/(?:nav|aside|footer)(?:\[\d+\])?(?:\/|$)/u;
const SECTION_REQUEST =
  /^(?:click|open|press|tap)\s+(?:.+\blink\s+(?:in|under)\s+(.+?)|.+\s+(?:in|under)\s+(.+? section))[.!]?$/iu;
const TITLE_REQUEST = /^(?:click|open|press|tap|find)\b.*\btitle links?\b/iu;

export type StructuralEvidence =
  | { inSection: boolean; section: string }
  | { title_link: true; title?: string };

type Context = (node: OutlineNode) => StructuralEvidence | undefined;

export function normalizeActionHeading(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}

function frameOf(id: string) {
  return id.slice(0, id.indexOf("-"));
}

function visibleHeading(snapshot: ActionSnapshot, node: OutlineNode) {
  const path = snapshot.xpathMap[node.id];
  const level = path && ELEMENT_PATH.test(path) ? HEADING.exec(path)?.[1] : undefined;
  const fact = snapshot.facts[node.id];
  if (!level || !fact?.visible || fact.tag !== `h${level}` || fact.text.length >= 160) return;
  if (normalizeActionHeading(node.name) !== normalizeActionHeading(fact.text)) return;
  return { path, level: Number(level) };
}

function sectionContext(
  snapshot: ActionSnapshot,
  nodes: OutlineNode[],
  requested: string,
): Context | undefined {
  const name = normalizeActionHeading(requested)
    .replace(/^the\s+/u, "")
    .replace(/\s+section$/u, "")
    .replace(/^["“]|["”]$/gu, "");
  if (!name) return;
  const matches = nodes.filter(
    (node) => node.role === "heading" && normalizeActionHeading(node.name) === name,
  );
  const heading = matches[0];
  if (matches.length !== 1 || !heading) return;
  const dom = visibleHeading(snapshot, heading);
  if (!dom) return;

  const frame = frameOf(heading.id);
  const parent = dom.path.slice(0, dom.path.lastIndexOf("/"));
  const entries = Object.entries(snapshot.xpathMap).filter(([id]) => frameOf(id) === frame);
  const start = entries.findIndex(([id]) => id === heading.id);
  const members = new Set<string>();
  // The DOM map is in traversal order. XPath indices alone cannot order unlike siblings.
  for (let i = start + 1; i < entries.length; i++) {
    const [id, path] = entries[i]!;
    if (!path.startsWith(`${parent}/`)) break;
    const relative = path.slice(parent.length);
    const level = relative.indexOf("/", 1) === -1 ? HEADING.exec(relative)?.[1] : undefined;
    if (level && Number(level) <= dom.level) break;
    if (!LANDMARK.test(relative)) members.add(id);
  }
  return (node) => {
    const path = snapshot.xpathMap[node.id];
    if (node.role !== "link" || !path || !ELEMENT_PATH.test(path)) return;
    return { inSection: members.has(node.id), section: heading.name };
  };
}

export function actionContext(
  snapshot: ActionSnapshot,
  nodes: OutlineNode[],
  instruction: string,
): Context | undefined {
  const request = SECTION_REQUEST.exec(instruction.trim());
  if (request) {
    const section = sectionContext(snapshot, nodes, request[1] ?? request[2]!);
    if (section) return section;
  }

  const unquoted = instruction.replace(/"[^"]*"|“[^”]*”/gu, "");
  if (!TITLE_REQUEST.test(unquoted.trim())) return;
  const headings = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.role !== "heading" || !visibleHeading(snapshot, node)) continue;
    const frame = frameOf(node.id);
    const paths = headings.get(frame) ?? [];
    paths.push(snapshot.xpathMap[node.id]!);
    headings.set(frame, paths);
  }
  if (!headings.size) return;
  return (node) => {
    const path = snapshot.xpathMap[node.id];
    const fact = snapshot.facts[node.id];
    if (node.role !== "link" || fact?.tag !== "a" || !path || !ELEMENT_PATH.test(path)) return;
    if (
      !headings
        .get(frameOf(node.id))
        ?.some((heading) => path.startsWith(`${heading}/`) || heading.startsWith(`${path}/`))
    ) {
      return;
    }
    return {
      title_link: true,
      ...(fact.title && fact.title !== node.name ? { title: fact.title.slice(0, 160) } : {}),
    };
  };
}
