import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { archive, hash, type ObserveLabel, type ObserveSnapshot } from "./common.js";
const [source, dir, taskName, goldSelector] = process.argv.slice(2);
if (!source || !dir || !taskName || !goldSelector)
  throw new Error("Expected captures, new directory, task and corrected gold selector");
mkdirSync(dir);
for (const file of readdirSync(source))
  if (!["source", "manifest.json"].includes(file))
    copyFileSync(join(source, file), join(dir, file));
let correction: object | undefined;
for (const file of readdirSync(source).filter((f) => f.endsWith(".labels.json"))) {
  const labels: ObserveLabel[] = JSON.parse(readFileSync(join(source, file), "utf8"));
  const label = labels.find((l) => l.name === taskName);
  if (!label) continue;
  const snapshot: ObserveSnapshot = JSON.parse(
    readFileSync(join(source, file.replace(".labels", "")), "utf8"),
  );
  const first = label.required[0]!;
  const end = first.lastIndexOf("/form[");
  if (end < 0) throw new Error("No frozen form scope");
  const scope = first.slice(0, first.indexOf("]", end) + 1) + "/";
  const ids = Object.keys(snapshot.facts).filter(
    (id) =>
      snapshot.facts[id]!.tag === "input" &&
      snapshot.facts[id]!.editable &&
      snapshot.facts[id]!.visible &&
      snapshot.canonical[id]?.startsWith(scope),
  );
  const required = [...new Set(ids.map((id) => snapshot.canonical[id]!))];
  correction = {
    taskName,
    before: label.required.length,
    after: required.length,
    scope,
    reason:
      "Original gold selector required a name attribute and omitted the visible State text input. The frozen instruction asks for all text-entry fields. Original snapshot and DOM facts prove it belongs; every arm is rescored with no policy or instruction change.",
  };
  label.required = required;
  label.allowedPaths = required;
  label.goldIds = ids;
  label.domCount = required.length;
  label.gold = goldSelector;
  writeFileSync(join(dir, file), JSON.stringify(labels, null, 2));
}
if (!correction) throw new Error("Task not found");
archive(dir, {
  kind: "observe-grader-correction",
  source,
  originalManifestHash: hash(readFileSync(join(source, "manifest.json"))),
  correction,
  rescoreEveryArm: true,
  originalRunsPreserved: true,
  newInference: false,
});
process.stdout.write(JSON.stringify(correction) + "\n");
