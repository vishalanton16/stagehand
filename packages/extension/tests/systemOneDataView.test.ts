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

  it("keeps all terms across sibling sections despite differences in label markup", () => {
    const tree = `[1] RootWebArea
  [2] main
    [3] region: Basics
      [4] heading: Basics
      [5] DescriptionList
        [6] term: Open
        [7] definition: Open an item
        [8] term: Close
        [9] definition: Close an item
    [10] region: Advanced
      [11] heading: Advanced
      [12] DescriptionList
        [13] term: Export
          [14] link: Export
        [15] definition: Export an item
    [16] region: Other
      [17] heading: Other
      [18] DescriptionList
        [19] term: Print
          [20] code: Print
        [21] definition: Print an item
  [22] complementary
    [23] region: Archive
      [24] heading: Archive
      [25] DescriptionList
        [26] term: Obsolete
        [27] definition: Old command
        [28] term: Legacy
        [29] definition: Old command
        [30] term: Removed
        [31] definition: Old command`;
    const view = buildDataView(tree, {});
    const group = view.groups.find(
      (candidate) => candidate.role === "term" && candidate.records[0]?.id === "6",
    );
    expect(group?.records.map((record) => record.id)).toEqual(["6", "8", "13", "19"]);
    expect(group?.sections).toEqual(["Basics", "Advanced", "Other"]);
  });
});

it("builds records for alternating labels and prose within one heading", () => {
  const tree = `[1] document
  [2] heading: Commands
  [3] paragraph
    [4] StaticText: Use the following commands.
  [5] paragraph
    [6] StaticText: Open
  [7] paragraph
    [8] StaticText: Opens the current project.
  [9] paragraph
    [10] StaticText: Save
  [11] paragraph
    [12] StaticText: Saves changes to disk.
  [13] paragraph
    [14] StaticText: Close
  [15] paragraph
    [16] StaticText: Closes the current project.
  [17] heading: Notes
  [18] paragraph
    [19] StaticText: Draft`;
  const group = buildDataView(tree, {}).groups.find((candidate) => candidate.role === "label");
  expect(group?.sections).toEqual(["Commands"]);
  expect(group?.records.map((record) => [record.id, record.name])).toEqual([
    ["6", "Open"],
    ["10", "Save"],
    ["14", "Close"],
  ]);
});
