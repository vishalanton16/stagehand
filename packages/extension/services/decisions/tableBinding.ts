export type HtmlTable = {
  heading: string;
  caption: string;
  rows: {
    section: string;
    group?: number;
    cells: { text: string; header: boolean; scope: string; rowspan: number; colspan: number }[];
  }[];
};

export type TableCell = {
  table: string;
  row: string;
  column: string;
  tableName: string;
  rowLabel: string;
  columnLabel: string;
  text: string;
};

export type TableField = { name: string; type: "string" | "number"; description: string };

function grid(table: HtmlTable) {
  type Cell = HtmlTable["rows"][number]["cells"][number];
  const occupied: { cell: Cell; through: number }[] = [];
  return table.rows.map((row, index) => {
    const previous = table.rows[index - 1];
    if (previous && (previous.section !== row.section || previous.group !== row.group))
      occupied.length = 0;
    let column = 0;
    for (const cell of row.cells) {
      while (occupied[column] && occupied[column]!.through > index) column++;
      const width = Math.min(cell.colspan, 64);
      const through = cell.rowspan === 0 ? Infinity : index + cell.rowspan;
      for (let i = 0; i < width; i++) occupied[column + i] = { cell, through };
      column += width;
    }
    return Array.from(occupied, (entry) => (entry?.through > index ? entry.cell : undefined));
  });
}

export function tableCells(tables: HtmlTable[]): TableCell[] {
  return tables.flatMap((table, index) => {
    const tableId = `t${index}`;
    const tableName = [table.heading, table.caption].filter(Boolean).join(" / ");
    const rows = grid(table);
    const firstData = table.rows.findIndex(
      ({ cells, section }) =>
        section !== "THEAD" &&
        !cells.some((cell) => cell.scope === "col" || cell.scope === "colgroup") &&
        cells.some((cell) => !cell.header || cell.scope === "row"),
    );
    if (firstData < 1) return [];
    return rows.slice(firstData).flatMap((row, rowIndex) => {
      const rowSource = [...new Set(row.filter((cell) => cell?.text))];
      const labels = rowSource.filter((cell) => cell?.scope === "row");
      const rowLabel = [...new Set([...labels, ...rowSource.slice(0, 3)].map((cell) => cell!.text))]
        .join(" | ")
        .slice(0, 180);
      return row.flatMap((cell, columnIndex) => {
        if (!cell || cell.header) return [];
        const columnLabel = [
          ...new Set(
            rows
              .slice(0, firstData)
              .flatMap((headerRow) =>
                headerRow[columnIndex]?.text ? [headerRow[columnIndex]!.text] : [],
              ),
          ),
        ].join(" / ");
        if (!columnLabel) return [];
        return [
          {
            table: tableId,
            row: `${tableId}r${rowIndex}`,
            column: `${tableId}c${columnIndex}`,
            tableName,
            rowLabel,
            columnLabel,
            text: cell.text,
          },
        ];
      });
    });
  });
}

function words(text: string): Set<string> {
  return new Set(
    text
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .match(/[\p{L}\d]+/gu) ?? [],
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  let score = 0;
  for (const word of a) {
    if (b.has(word)) score += word.length < 3 ? 1 : 2;
  }
  return score;
}

export function shortlist(cells: TableCell[], field: TableField, instruction: string): TableCell[] {
  const requested = words(`${field.name} ${field.description}`);
  for (const common of [
    "a",
    "an",
    "the",
    "for",
    "from",
    "as",
    "in",
    "of",
    "to",
    "by",
    "value",
    "column",
    "row",
    "table",
    "with",
    "and",
  ])
    requested.delete(common);
  const task = words(instruction);
  return cells
    .map((cell) => {
      const row = words(cell.rowLabel);
      const column = words(cell.columnLabel);
      const table = words(cell.tableName);
      const colScore = overlap(requested, column);
      const rowAnchor = [...requested].some((word) => row.has(word) && !column.has(word));
      if (!colScore || !rowAnchor) return { cell, score: 0 };
      return {
        cell,
        score:
          4 * overlap(requested, row) +
          3 * colScore +
          overlap(requested, table) +
          overlap(task, row) +
          overlap(task, column),
      };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 16)
    .map(({ cell }) => cell);
}
