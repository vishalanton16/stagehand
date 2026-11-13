import { buildDataView, readSlot } from "./dataView.js";
import { loadFrozen } from "./replay.js";
const frozen = await loadFrozen(process.argv[2]!);
const view = buildDataView(frozen.tree, frozen.urlMap);
const group = view.groups.find((g) => g.id === process.argv[3])!;
const record = group.records[0]!;
for (const key of process.argv.slice(4)) {
  const node = readSlot(view, record, key);
  console.log(key, "=>", node?.index, node?.role, JSON.stringify(node?.name), "kids", view.children[node?.index ?? -1]?.map((i) => `${view.nodes[i]!.role}:${view.nodes[i]!.name.slice(0, 30)}`));
}
