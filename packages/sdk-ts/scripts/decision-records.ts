import type { OutlineNode } from "../../extension/services/decisions/outline.js";
import { baselineModule } from "./system-one/baseline.js";
const { describeCandidate, parseOutline } = await baselineModule("services/decisions/tree");

type EvidenceRecord = { title: string; lines: string[]; sourceIds: string[] };

export function collectRecords(tree: string, includeParagraphs = false): EvidenceRecord[] {
  const nodes = parseOutline(tree);
  const records: EvidenceRecord[] = [];
  const leaf = (node: OutlineNode) =>
    node.name && ["statictext", "cell", "link"].includes(node.role.toLowerCase());
  function collect(root: OutlineNode, title: string) {
    const lines: string[] = [];
    const sourceIds: string[] = [];
    for (let index = root.index + 1; index < nodes.length; index++) {
      const node = nodes[index];
      if (node.depth <= root.depth) break;
      if (!leaf(node)) continue;
      const context = describeCandidate(nodes, node).table;
      const label =
        typeof context === "object" && context && !Array.isArray(context)
          ? context.column
          : undefined;
      const line =
        typeof label === "string" && label !== node.name ? `${label}: ${node.name}` : node.name;
      if (lines.includes(line)) continue;
      lines.push(line);
      sourceIds.push(node.id);
      if (lines.length === 24) break;
    }
    if (lines.length) records.push({ title, lines, sourceIds });
  }
  for (const node of nodes) {
    if (node.role === "row") collect(node, node.name || "Table row");
    if (includeParagraphs && ["paragraph", "listitem"].includes(node.role.toLowerCase())) {
      const title = describeCandidate(nodes, node).under_heading;
      collect(node, typeof title === "string" ? title : node.role);
    }
    if (node.role === "heading" && node.parent !== undefined) {
      const parent = nodes[node.parent];
      const before = records.length;
      collect(parent, node.name);
      const added = records[before];
      if (added && !added.lines.includes(node.name)) added.lines.unshift(node.name);
    }
  }
  return records;
}

export function rankRecords(records: EvidenceRecord[], query: string, limit = 5): EvidenceRecord[] {
  const wanted = new Set(
    query
      .toLowerCase()
      .match(/[\p{L}\d]+/gu)
      ?.filter((token) => token.length > 2) ?? [],
  );
  const overlap = (value: string) =>
    new Set(
      value
        .toLowerCase()
        .match(/[\p{L}\d]+/gu)
        ?.filter((token) => wanted.has(token)) ?? [],
    ).size;
  const ranked = records
    .map((record) => ({
      record,
      score: 4 * overlap(record.title) + overlap(record.lines.join(" ")),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  return ranked
    .flatMap(({ record }) => {
      const key = record.sourceIds.join(",");
      if (seen.has(key)) return [];
      seen.add(key);
      return [record];
    })
    .slice(0, limit);
}

export function renderRecords(records: EvidenceRecord[]): string {
  return records
    .map(({ title, lines }) => [title, ...lines.filter((line) => line !== title)].join("\n"))
    .join("\n\n");
}

export function oracleRecords(tree: string, selectors: RegExp[]): string {
  const nodes = parseOutline(tree);
  const records = collectRecords(tree);
  const picked = selectors.map((selector) => {
    const hit = nodes.find((node) => selector.test(node.name));
    if (!hit) throw new Error(`Oracle evidence missing: ${selector.source}`);
    const enclosing = records
      .filter(
        (record) =>
          record.sourceIds.includes(hit.id) && record.lines.some((line) => line.includes(hit.name)),
      )
      .sort((a, b) => a.lines.length - b.lines.length)[0];
    if (enclosing) return enclosing;
    const paragraph = nodes[hit.parent ?? hit.index];
    const tail = nodes.slice(paragraph.index + 1);
    const boundary = tail.findIndex((item) => item.depth <= paragraph.depth);
    const lines = tail
      .slice(0, boundary === -1 ? tail.length : boundary)
      .filter((node) => node.role.toLowerCase() === "statictext")
      .map((node) => node.name);
    return { title: hit.name, lines: lines.length ? lines : [hit.name], sourceIds: [hit.id] };
  });
  return renderRecords([...new Set(picked)]);
}
