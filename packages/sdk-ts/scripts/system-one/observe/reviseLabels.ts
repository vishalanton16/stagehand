import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { archive, hash, type ObserveLabel, type ObserveSnapshot } from "./common.js";

const [source, dir] = process.argv.slice(2);
if (!source || !dir) throw new Error("Expected original captures and new revised-label directory");
mkdirSync(dir);
for (const file of readdirSync(source))
  if (!["source", "manifest.json"].includes(file))
    copyFileSync(join(source, file), join(dir, file));
for (const file of readdirSync(source).filter((f) => f.endsWith(".labels.json"))) {
  const snapshotFile = file.replace(".labels", "");
  const snapshot: ObserveSnapshot = JSON.parse(readFileSync(join(source, snapshotFile), "utf8"));
  const labels: ObserveLabel[] = JSON.parse(readFileSync(join(source, file), "utf8"));
  const anchors = Object.keys(snapshot.facts).filter(
    (id) => snapshot.facts[id]!.tag === "a" && snapshot.facts[id]!.href,
  );
  for (const id of Object.keys(snapshot.canonical)) {
    if (snapshot.facts[id]?.tag !== "img") continue;
    const ancestor = anchors.find((a) =>
      snapshot.canonical[id]!.startsWith(snapshot.canonical[a]! + "/"),
    );
    if (ancestor) snapshot.canonical[id] = snapshot.canonical[ancestor]!;
  }
  for (const label of labels) {
    if (["form-name", "form-contact"].includes(label.name))
      label.methods = ["click", "fill", "type"];
    if (label.name === "books-one" || label.workload === "discovery") {
      label.requiredGroups = label.required.map((path) => {
        const id = anchors.find((id) => snapshot.canonical[id] === path);
        return id
          ? [
              ...new Set(
                anchors
                  .filter((a) => snapshot.facts[a]!.href === snapshot.facts[id]!.href)
                  .map((a) => snapshot.canonical[a]!),
              ),
            ]
          : [path];
      });
      if (label.name === "books-one")
        label.allowedPaths = [...new Set(label.requiredGroups.flat())];
    }
  }
  writeFileSync(join(dir, snapshotFile), JSON.stringify(snapshot));
  writeFileSync(join(dir, file), JSON.stringify(labels, null, 2));
}
archive(dir, {
  kind: "observe-grader-correction",
  source,
  originalManifestHash: hash(readFileSync(join(source, "manifest.json"))),
  version: 2,
  reasons: [
    "Find a field permits click/focus as well as fill with no arguments. Original grader incorrectly required fill/type.",
    "A product image link and title link sharing the same destination are acceptable alternatives for finding its details; no-instruction discovery likewise needs that logical action, not a specific duplicate anchor.",
    "An image inside an anchor activates that anchor. Normalize this identity in every arm and still reject repeated normalized selectors.",
  ],
  rescoreEveryArm: true,
  originalRunsPreserved: true,
});
