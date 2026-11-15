import type { UnderstudyRuntimePage } from "../../runtime.js";
import { parseOutline } from "./tree.js";

type Candidate = { id: string; xpath: string; name: string };

const MAX_CELLS = 32;
const MAX_NAME_LENGTH = 256;

export async function readDomCodeText(
  page: Pick<UnderstudyRuntimePage, "evaluate">,
  tree: string,
  xpathMap: Record<string, string>,
): Promise<{ tree: string; inspected: number; corrected: number }> {
  const nodes = parseOutline(tree);
  const codeCells = new Set(
    nodes.filter((node) => node.role === "code").map((node) => node.parent),
  );
  const candidates: Candidate[] = [];
  for (const node of nodes) {
    if (candidates.length === MAX_CELLS) break;
    if (node.role !== "cell" || node.flags.length || !codeCells.has(node.index)) continue;
    if (!/^0-\d+$/.test(node.id) || !node.name.includes(" ")) continue;
    const xpath = xpathMap[node.id];
    if (!xpath?.startsWith("/") || node.name.length > MAX_NAME_LENGTH) continue;
    candidates.push({ id: node.id, xpath, name: node.name });
  }
  if (!candidates.length) return { tree, inspected: 0, corrected: 0 };

  const xpaths = candidates.map(({ xpath }) => xpath);
  const values = await page.evaluate(`(${readCells.toString()})(${JSON.stringify(xpaths)})`);
  if (!Array.isArray(values)) return { tree, inspected: candidates.length, corrected: 0 };

  const replacements = new Map<string, string>();
  for (const [index, { id, name }] of candidates.entries()) {
    const rendered = values[index];
    if (typeof rendered !== "string" || !rendered || rendered === name) continue;
    if (rendered.length > MAX_NAME_LENGTH) continue;
    if (/[\r\n\u2028\u2029]/.test(rendered) || / \[(?:selected|checked)\]$/.test(rendered))
      continue;
    // The rendered cell is evidence only for whitespace; it cannot replace the AX payload.
    if (rendered.replaceAll(" ", "") !== name.replaceAll(" ", "")) continue;
    replacements.set(`[${id}] cell: ${name}`, `[${id}] cell: ${rendered}`);
  }
  let corrected = 0;
  const adjusted = replacements.size
    ? tree
        .split("\n")
        .map((line) => {
          const content = line.trimStart();
          const replacement = replacements.get(content);
          if (!replacement) return line;
          corrected++;
          return line.slice(0, line.length - content.length) + replacement;
        })
        .join("\n")
    : tree;
  return { tree: adjusted, inspected: candidates.length, corrected };
}

function readCells(xpaths: string[]): (string | null)[] {
  return xpaths.map((xpath) => {
    const cell = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
    ).singleNodeValue;
    if (!(cell instanceof HTMLTableCellElement) || !cell.getClientRects().length) return null;
    const code = cell.querySelectorAll("code");
    if (code.length !== 1 || !code[0]!.getClientRects().length) return null;
    const rendered = cell.innerText.trim();
    return rendered === code[0]!.innerText.trim() ? rendered : null;
  });
}
