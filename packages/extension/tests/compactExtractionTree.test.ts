import { expect, it } from "vitest";
import { compactExtractionTree } from "../../sdk-ts/scripts/system-one/experiments/compactExtractionTree.js";

it("compacts repeated child text and keeps table order, exact literals and link IDs", () => {
  const tree = [
    "[0-1] heading: Plans",
    "  [0-2] StaticText: Plans",
    "[0-3] table",
    "  [0-4] row",
    "    [0-5] columnheader: Price",
    "      [0-6] StaticText: Price",
    "    [0-7] cell: $1,024.00/mo",
    "      [0-8] StaticText: $1,024.00/mo",
    "  [0-9] row",
    "    [0-10] cell: $0/mo",
    "[0-11] link: Full prices",
    "  [0-12] StaticText: Full prices",
  ].join("\n");

  expect(compactExtractionTree(tree, new Set(["0-11"]))).toBe(
    [
      "heading: Plans",
      "table",
      "  row",
      "    columnheader: Price",
      "    cell: $1,024.00/mo",
      "  row",
      "    cell: $0/mo",
      "[0-11] link: Full prices",
    ].join("\n"),
  );
});

it("keeps sibling duplicates, state and multiline text", () => {
  const tree = [
    "[0-1] paragraph: Example",
    "  [0-2] StaticText: Example",
    "    continuation  with spaces",
    "[0-3] list",
    "  [0-4] listitem: Item",
    "  [0-5] listitem: Item",
    "[0-6] checkbox: Checked item [checked]",
  ].join("\n");

  expect(compactExtractionTree(tree, new Set())).toBe(
    [
      "paragraph: Example",
      "  StaticText: Example",
      "    continuation  with spaces",
      "list",
      "  listitem: Item",
      "  listitem: Item",
      "checkbox: Checked item [checked]",
    ].join("\n"),
  );
});
