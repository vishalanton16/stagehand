import { describe, expect, it } from "vitest";
import { buildDataView } from "../services/decisions/dataView.js";

describe("nested record scopes", () => {
  it("collects leaf records across subsections without including the next section", () => {
    const tree = `[1] RootWebArea
  [2] heading: Catalog
  [3] div
    [4] heading: Fruit
    [5] list
      [6] listitem
        [7] link: apple
      [8] listitem
        [9] link: pear
    [10] heading: Vegetables
    [11] list
      [12] listitem
        [13] link: carrot
      [14] listitem
        [15] link: onion
  [16] heading: Archive
  [17] list
    [18] listitem
      [19] link: old apple
    [20] listitem
      [21] link: old pear`;
    const view = buildDataView(tree, {});
    const group = view.groups.find(
      (candidate) => candidate.sections.includes("Catalog") && candidate.role === "listitem",
    );
    expect(group?.records.map((record) => record.id)).toEqual(["6", "8", "12", "14"]);
    expect(group?.slots.flatMap((slot) => slot.samples)).not.toContain("old apple");
    expect(group?.slots.every((slot) => slot.coverage >= 0 && slot.coverage <= 1)).toBe(true);
  });
});
