import { actionNodes } from "../../../extension/services/decisions/actionPlans.js";
import {
  matchesObservationType,
  observationView,
} from "../../../extension/services/decisions/observeCandidates.js";
import { runtime, type ReplayArm } from "./arms.js";

const SECTION_REQUEST = /^find all (text )?links in the (.+) section\.?$/iu;
const normalize = (value: string) =>
  value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();

const section: ReplayArm = async (input) => {
  const { snapshot, instruction } = input;
  const match = SECTION_REQUEST.exec(instruction ?? "");
  if (!match) return runtime(input);
  const headingName = normalize(match[2]!.replace(/^["“]|["”]$/gu, ""));
  const nodes = actionNodes(snapshot);
  const headings = nodes.filter(
    ({ role, name }) => role === "heading" && normalize(name) === headingName,
  );
  const heading = headings[0];
  if (headings.length !== 1 || !heading || heading.parent === undefined) return runtime(input);

  const headingLevel = (tag: string | undefined) =>
    /^h[1-6]$/u.test(tag ?? "") ? Number(tag![1]) : undefined;
  const level = headingLevel(snapshot.facts[heading.id]?.tag);
  const path = snapshot.xpathMap[heading.id];
  if (!level || !path) return runtime(input);
  const parentPath = path.slice(0, path.lastIndexOf("/"));
  const parent = nodes[heading.parent]!;
  if (!parentPath || snapshot.xpathMap[parent.id] !== parentPath) return runtime(input);

  let end = nodes.length;
  for (const neighbor of nodes.slice(heading.index + 1)) {
    if (neighbor.depth <= parent.depth) {
      end = neighbor.index;
      break;
    }
    if (neighbor.id.split("-")[0] !== heading.id.split("-")[0]) return runtime(input);
    if (neighbor.role !== "heading") continue;
    const nextLevel = headingLevel(snapshot.facts[neighbor.id]?.tag);
    if (!nextLevel) return runtime(input);
    if (nextLevel <= level) {
      end = neighbor.index;
      break;
    }
  }

  const { candidates, unresolved } = observationView(snapshot);
  if (unresolved.length) return runtime(input);
  const links = candidates.filter(
    ({ node, ...candidate }) =>
      node.index > heading.index &&
      node.index < end &&
      matchesObservationType({ node, ...candidate }, match[1] ? "text_link" : "link"),
  );
  if (
    !links.length ||
    links.some(({ node }) => {
      const linkPath = snapshot.xpathMap[node.id];
      return !linkPath?.startsWith(`${parentPath}/`) || linkPath.startsWith(`${path}/`);
    })
  )
    return runtime(input);

  return {
    kind: "done",
    actions: links.map(({ node, selector }) => ({
      selector,
      method: "click",
      arguments: [],
      description: node.name ? `${node.role}: ${node.name}` : node.role,
    })),
  };
};

export default section;
