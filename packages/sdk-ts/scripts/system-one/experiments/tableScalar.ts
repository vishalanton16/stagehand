import { z } from "zod/v4";
import type { UnderstudyRuntimePage } from "../../../../extension/runtime.js";
import type { Progress } from "../../../../extension/understudy/progress.js";
import {
  decide,
  type DecisionModelConfig,
  type DecisionQuestion,
} from "../../../../extension/services/decisions/client.js";
import { extractWithDecider } from "./decider.js";
import type { JsonSchema } from "../../../../extension/services/decisions/mapCopy.js";
import {
  shortlist,
  tableCells,
  type HtmlTable,
  type TableCell,
  type TableField,
} from "./tableBinding.js";

// Keep the browser read in one batch. A table that exceeds the budget is
// skipped as a whole so missing rows cannot look like absent values.
const tableCapture = String.raw`(() => {
  const output = [];
  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")];
  let budget = 2400;
  const clean = (value) => value.trim().replace(/\s+/g, " ");
  const visible = (node) => node.getClientRects().length && getComputedStyle(node).visibility === "visible";
  for (const table of document.querySelectorAll("table")) {
    if (output.length >= 24 || budget < 1) break;
    if (!visible(table) || table.querySelector("table") || table.rows.length > 550) continue;
    const rows = Array.from(table.rows);
    const cellCount = rows.reduce((sum, row) => sum + row.cells.length, 0);
    if (cellCount > budget || !cellCount) continue;
    const groups = Array.from(table.children);
    const heading = headings.filter((node) =>
      node.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING
    ).at(-1);
    output.push({
      heading: clean(heading?.innerText ?? "").slice(0, 160),
      caption: clean(table.caption?.innerText ?? "").slice(0, 160),
      rows: rows.map((row) => ({
        section: row.parentElement?.tagName ?? "",
        group: groups.indexOf(row.parentElement),
        cells: Array.from(row.cells, (cell) => {
          const text = visible(cell) ? clean(cell.innerText) : "";
          return {
            text: text.length <= 500 ? text : "",
            scope: cell.scope,
            header: cell.tagName === "TH",
            rowspan: cell.rowSpan,
            colspan: cell.colSpan,
          };
        }),
      })),
    });
    budget -= cellCount;
  }
  return output;
})()`;

type Field = TableField & { schema: JsonSchema };
type CandidateField = { field: Field; cells: TableCell[] };

export async function prepareTableScalar(
  page: Pick<UnderstudyRuntimePage, "evaluate">,
  schema: JsonSchema,
  instruction: string,
): Promise<CandidateField[] | undefined> {
  const tables = await page.evaluate(tableCapture);
  if (!Array.isArray(tables) || !tables.length) return undefined;
  return prepareTableScalarFromTables(tables as HtmlTable[], schema, instruction);
}

export function prepareTableScalarFromTables(
  tables: HtmlTable[],
  schema: JsonSchema,
  instruction: string,
): CandidateField[] | undefined {
  const cells = tableCells(tables);
  const fields = Object.entries(schema.properties ?? {}).map(([name, fieldSchema]) => {
    const field: Field = {
      name,
      type: fieldSchema.type === "string" ? "string" : "number",
      description: fieldSchema.description?.trim() || name.replace(/([a-z0-9])([A-Z])/g, "$1 $2"),
      schema: fieldSchema,
    };
    return { field, cells: shortlist(cells, field, instruction) };
  });
  return fields.length && fields.every((entry) => entry.cells.length) ? fields : undefined;
}

function copyNumber(text: string, context: string): number | undefined {
  const match = /^([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s+(\p{L}+))?$/u.exec(text);
  if (!match) return undefined;
  const unit = match[2]?.toLowerCase();
  if (
    unit &&
    !context
      .toLowerCase()
      .match(/[\p{L}]+/gu)
      ?.includes(unit)
  )
    return undefined;
  const value = Number(match[1]!.replaceAll(",", ""));
  return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))
    ? value
    : undefined;
}

export async function extractTableScalar(
  config: DecisionModelConfig,
  instruction: string,
  candidates: CandidateField[],
  progress: Progress,
  trace: { field: string; table: string; row: string; column: string }[],
): Promise<Record<string, unknown>> {
  const questions: Record<string, DecisionQuestion> = {};
  for (const [index, { field, cells }] of candidates.entries()) {
    questions[`cell${index}`] = {
      type: "choice",
      instructions: `Which cell supplies ${field.description}? Return none if the exact cell is absent.`,
      criteria: {
        ...Object.fromEntries(
          cells.map((cell, slot) => [
            `c${slot}`,
            `${cell.tableName} | row ${cell.rowLabel} | column ${cell.columnLabel} | value ${cell.text || "(empty)"}`,
          ]),
        ),
        none: "No such cell",
      },
    };
  }
  const { answers } = await decide(config, { task: instruction }, questions);
  const output: Record<string, unknown> = {};
  for (const [index, { field, cells }] of candidates.entries()) {
    const answer = answers[`cell${index}`];
    const cell =
      answer?.type === "choice" && answer.choice !== "none"
        ? cells[Number(answer.choice.slice(1))]
        : undefined;
    if (!cell?.text) throw new Error(`missing_table_cell:${field.name}`);
    trace.push({ field: field.name, table: cell.table, row: cell.row, column: cell.column });
    const direct =
      field.type === "string"
        ? cell.text
        : copyNumber(cell.text, `${cell.columnLabel} ${field.description}`);
    const validator = z.fromJSONSchema(field.schema as Parameters<typeof z.fromJSONSchema>[0]);
    if (validator.safeParse(direct).success) {
      output[field.name] = direct;
      continue;
    }
    const result = await extractWithDecider({
      params: {
        pageId: "table-cell",
        instruction: `Copy only ${field.description} from this selected cell.`,
        schema: z.json().parse({
          type: "object",
          properties: { [field.name]: field.schema },
          required: [field.name],
        }),
      },
      page: {
        captureSnapshot: async () => ({
          combinedTree: cell.text,
          combinedXpathMap: {},
          combinedUrlMap: {},
        }),
      },
      model: {
        apiKey: config.apiKey,
        modelName: config.model ?? "pplx-decider-latest",
        apiUrl: config.apiUrl,
        timeoutMs: 15_000,
      },
      systemPrompt: "",
      progress,
      recordUsage: config.recordDecisionUsage,
      boundedScalar: true,
    });
    output[field.name] = (result.data as Record<string, unknown>)[field.name];
  }
  return output;
}
