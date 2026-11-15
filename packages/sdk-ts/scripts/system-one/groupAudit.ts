import { readFileSync } from "node:fs";
import { z } from "zod/v4";
import { baselineModule } from "./baseline.js";
const { listGroupRanks } = await baselineModule("services/decisions/mapCopy");
import { CORPUS_DIR, corpusTasks } from "./capture.js";
import { groupLabels } from "./groupLabels.js";

for (const [name, label] of Object.entries(groupLabels)) {
  const task = corpusTasks.find((task) => task.name === name);
  if (!task) throw new Error(`Missing task: ${name}`);
  const { tree, urlMap } = JSON.parse(readFileSync(new URL(`${name}.json`, CORPUS_DIR), "utf8"));
  const [list] = listGroupRanks({
    tree,
    urlMap,
    schema: z.toJSONSchema(task.schema),
    instruction: task.instruction,
  });
  if (!list) throw new Error(`Missing list: ${name}`);
  const covering = list.groups.filter(
    ({ records }) =>
      records.length >= label.rows && records.includes(label.first) && records.includes(label.last),
  );
  const exact = covering.filter(
    ({ records }) =>
      records.length === label.rows && records[0] === label.first && records.at(-1) === label.last,
  );
  if (label.oracle && !covering.some(({ id }) => id === label.oracle))
    throw new Error(`Oracle no longer covers the labeled rows: ${name}`);
  const rankOf = (ids: string[], matches: typeof covering) => {
    const index = ids.findIndex((id) => matches.some((group) => group.id === id));
    return index === -1 ? null : index + 1;
  };
  process.stdout.write(
    JSON.stringify({
      task: name,
      covering: covering.map(({ id }) => id),
      exact: exact.map(({ id }) => id),
      baseline: { covering: rankOf(list.baseline, covering), exact: rankOf(list.baseline, exact) },
      schema: {
        covering: rankOf(list.schema.slice(0, 8), covering),
        exact: rankOf(list.schema.slice(0, 8), exact),
      },
    }) + "\n",
  );
}
