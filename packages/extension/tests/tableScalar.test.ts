import { expect, it, vi } from "vitest";
import { prepareTableScalar } from "../services/decisions/tableScalar.js";

const cell = (text: string) => ({ text, header: false, scope: "", rowspan: 1, colspan: 1 });
const header = (text: string) => ({ ...cell(text), header: true, scope: "col" });
const page = {
  evaluate: vi.fn(async () => [
    {
      heading: "Limits",
      caption: "",
      rows: [
        {
          section: "THEAD",
          group: 0,
          cells: [header("Group"), header("Plan"), header("Storage size")],
        },
        {
          section: "TBODY",
          group: 1,
          cells: [{ ...cell("First"), rowspan: 0 }, cell("Basic"), cell("5 bytes")],
        },
        { section: "TBODY", group: 1, cells: [cell("Pro"), cell("16 bytes")] },
        { section: "TBODY", group: 2, cells: [cell("Second"), cell("Starter"), cell("2 bytes")] },
      ],
    },
  ]),
};
const size = { type: "number", description: "Storage size for the Pro plan in bytes" };

it("keeps rowspan cells aligned and resets at the next row group", async () => {
  const prepared = await prepareTableScalar(
    page,
    {
      type: "object",
      properties: {
        pro: size,
        starter: { type: "number", description: "Storage size for Starter in bytes" },
      },
    },
    "Find storage sizes for Pro and Starter",
  );
  expect(prepared?.map(({ cells }) => cells[0])).toEqual([
    expect.objectContaining({
      columnLabel: "Storage size",
      rowLabel: "First | Pro | 16 bytes",
      text: "16 bytes",
    }),
    expect.objectContaining({
      columnLabel: "Storage size",
      rowLabel: "Second | Starter | 2 bytes",
      text: "2 bytes",
    }),
  ]);
});

it("routes a mixed table and prose schema away from the table reader", async () => {
  const prepared = await prepareTableScalar(
    page,
    {
      type: "object",
      properties: {
        pro: size,
        issuer: { type: "string", description: "Publisher named in the prose" },
      },
    },
    "Find the Pro storage size and publisher",
  );
  expect(prepared).toBeUndefined();
});
