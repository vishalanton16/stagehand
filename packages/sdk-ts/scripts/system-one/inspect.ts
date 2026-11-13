/** Prints the data view for frozen corpus tasks: `inspect.ts <task> [field-substring]`. */
import { buildDataView, recordText } from "./dataView.js";
import { loadFrozen } from "./replay.js";

const [name, filter] = process.argv.slice(2);
const frozen = loadFrozen(name!);
const view = buildDataView(frozen.tree, frozen.urlMap);
console.log("groups", view.groups.length, "facts", view.facts.length);
for (const group of view.groups.toSorted((a, b) => b.records.length - a.records.length).slice(0, 6)) {
  console.log(
    group.id,
    group.role,
    group.records.length,
    "ctx",
    JSON.stringify([...new Set(group.context)].slice(0, 4)),
    "|",
    recordText(view, group.records[0]!, 110),
  );
  for (const slot of group.slots.slice(0, 8)) {
    console.log(
      "   ",
      slot.key,
      slot.label ?? "",
      slot.coverage.toFixed(2),
      JSON.stringify(slot.samples.slice(0, 2)).slice(0, 80),
      slot.urlSamples.length ? `url ${slot.urlSamples[0]}` : "",
    );
  }
}
if (filter) {
  for (const fact of view.facts) {
    if (`${fact.label} ${fact.value}`.toLowerCase().includes(filter.toLowerCase())) {
      console.log("FACT", JSON.stringify(fact.label), "=>", JSON.stringify(fact.value.slice(0, 120)));
    }
  }
}
