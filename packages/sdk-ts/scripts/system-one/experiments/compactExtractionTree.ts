const nodeLine = /^( *)\[(\d+-\d+)\] (.*)$/;
const textContainer =
  /^(?:button|cell|columnheader|gridcell|heading|labeltext|link|paragraph|rowheader|term): (.+)$/i;

export function compactExtractionTree(tree: string, retainedIds: ReadonlySet<string>): string {
  const lines = tree.split("\n");
  const parsed = lines.map((line) => nodeLine.exec(line));
  return lines
    .flatMap((line, index) => {
      const node = parsed[index];
      if (!node || retainedIds.has(node[2]!)) return [line];
      const [, indent, , content] = node;
      const parent = parsed[index - 1];
      const next = parsed[index + 1];
      // A leaf repeating its only parent's exact name carries no additional text.
      // Keep possible continuation lines and all text under multi-child containers.
      if (
        content!.startsWith("StaticText: ") &&
        parent &&
        indent!.length === parent[1]!.length + 2 &&
        (index === lines.length - 1 || (next && next[1]!.length <= parent[1]!.length)) &&
        textContainer.exec(parent[3]!)?.[1] === content!.slice("StaticText: ".length)
      )
        return [];
      return [indent + content!];
    })
    .join("\n");
}
