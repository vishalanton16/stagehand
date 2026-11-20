import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decide,
  DecisionRequestError,
  type DecisionQuestion,
} from "../../../extension/services/decisions/client.js";
import { parseOutline } from "../../../extension/services/decisions/outline.js";

const vendor = process.argv[2];
if (!vendor) throw new Error("Usage: probe.ts <vendor-repos> [--live]");
const live = process.argv.includes("--live");
const apiKey = process.env.PERPLEXITY_API_KEY;
if (live && !apiKey) throw new Error("PERPLEXITY_API_KEY is required");

type Capture = {
  formattedTree: string;
  xpathMap: Record<string, string>;
  facts?: Record<string, { text: string; visible: boolean; tag: string }>;
};
const sectionDir = join(vendor, "system-one-study-2026-11-20", "section-capture");
const manifest = JSON.parse(readFileSync(join(sectionDir, "capture.json"), "utf8")) as {
  captures: { site: string; sha256: string }[];
};

function section(site: string): Capture {
  const entry = manifest.captures.find((capture) => capture.site === site);
  assert(entry);
  const bytes = readFileSync(join(sectionDir, entry.sha256 + ".json"));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
  return JSON.parse(bytes.toString("utf8"));
}

function corpus(name: string, sha256: string): Capture {
  const bytes = readFileSync(join(vendor, "system-one-corpus", name + ".json"));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), sha256);
  return JSON.parse(bytes.toString("utf8"));
}

function outline(capture: Capture, id: string) {
  const line = capture.formattedTree
    .split("\n")
    .find((text) => text.trimStart().startsWith(`[${id}] `));
  assert(line && capture.xpathMap[id], id);
  return line.slice(line.indexOf(": ") + 2);
}

function dom(capture: Capture, id: string) {
  const fact = capture.facts?.[id];
  assert(fact?.visible && fact.text.length < 160 && capture.xpathMap[id], id);
  return fact.text;
}

type Candidate = {
  id: string;
  scope: string;
  text: string;
  value: string;
};
const candidate = (id: string, scope: string, text: string, value = text): Candidate => {
  assert(text.includes(value) && value.length > 0, id);
  return { id, scope, text, value };
};

const nist = corpus(
  "hold5_nist_temp",
  "6adec08f1367d93d7e50ed82ac1db070fa9f36f51dd3c74843343cecccfab182",
);
const github = corpus(
  "hold7_github_repo_qualifiers",
  "92003380c26b399e60ae4ba319a0086703ddf4f0bbbd4237d15fce0209e5b1d6",
);
const wcag = section("wcag");
const readme = section("github-readme");
const git = section("git-switch");
assert.equal(outline(github, "0-1378"), "repo:USERNAME/ REPOSITORY");
assert.equal(outline(wcag, "0-713"), "JSON Serialization of WCAG 2 – GitHub External Site");
assert.equal(outline(readme, "0-1228"), "[Contribution");
assert.equal(outline(git, "0-1443"), "$ git switch -m mytopic");
const parsedName = (capture: Capture, id: string) =>
  parseOutline(capture.formattedTree).find((node) => node.id === id)?.name;
assert.equal(parsedName(readme, "0-1228"), dom(readme, "0-1212"));
assert.equal(
  dom(readme, "0-1228"),
  dom(readme, "0-1212").replace("Contribution ", "Contribution\n"),
);
assert.equal(parsedName(git, "0-1443")?.split("changes:").at(-1), " M\tfrotz");
assert.equal(dom(wcag, "0-713"), "JSON Serialization of WCAG 2 – GitHub");

const precise = candidate("0-128", "Introductory prose", outline(nist, "0-128"), "273.15 K");
const triple = candidate("0-129", "Introductory prose", outline(nist, "0-129"), "273.16 K");
const rounded = candidate(
  "0-1093",
  "Touchstone Temperatures (Approximate), Freezing Point of Water row, Kelvin (K) column",
  outline(nist, "0-1093"),
);
const formula = candidate(
  "0-1162",
  "Temperature Conversion (Exact), Celsius row, To Kelvin column",
  outline(nist, "0-1162"),
  "273.15",
);
const githubCells = [
  // The third value is the fresh Chrome read of the cell corresponding to the archived ID.
  candidate("0-1378", "Repositories search table, Qualifier column", "repo:USERNAME/REPOSITORY"),
  candidate("0-1364", "Repositories search table, Qualifier column", outline(github, "0-1364")),
  candidate("0-1371", "Repositories search table, Qualifier column", outline(github, "0-1371")),
  candidate(
    "0-1381",
    "Repositories search table, Example column",
    outline(github, "0-1381"),
    "repo:mozilla/shumway",
  ),
];
const markdown = [
  candidate("0-1212", "Relative links, first code example on one line", dom(readme, "0-1212")),
  candidate(
    "0-1228",
    "Relative links, second code example spanning two lines",
    dom(readme, "0-1228"),
  ),
  candidate("0-1205", "Relative links, prose mentions the path", dom(readme, "0-1205")),
];
const output = dom(git, "0-1443");
const cases = [
  {
    name: "github-cell",
    task: "Copy the exact repository qualifier template in the Qualifier column.",
    expected: "0-1378",
    candidates: githubCells,
  },
  {
    name: "nist-exact",
    task: "Copy the exact kelvin equivalent of the freezing point of water as stated on the page. Omit approximations and never compute a conversion.",
    expected: "0-128",
    candidates: [rounded, triple, formula, precise],
  },
  {
    name: "nist-scoped-approximate",
    task: "Copy the Kelvin cell for Freezing Point of Water in Touchstone Temperatures (Approximate).",
    expected: "0-1093",
    candidates: [triple, precise, rounded, formula],
  },
  {
    name: "nist-absent",
    task: "Copy the exact kelvin equivalent of the freezing point of water as stated on the page. Omit approximations and never compute a conversion.",
    expected: "none",
    candidates: [rounded, triple, formula],
  },
  {
    name: "readme-multiline",
    task: "Copy the full second relative Markdown link example with its internal newline.",
    expected: "0-1228",
    candidates: markdown,
  },
  {
    name: "wcag-visible",
    task: "Copy the visible link text for the WCAG JSON serialization in More about WCAG.",
    expected: "0-713",
    candidates: [
      candidate("0-713", "More about WCAG, visible link text", dom(wcag, "0-713")),
      candidate("0-631", "Translations, visible link text", dom(wcag, "0-631")),
    ],
  },
  {
    name: "git-tab",
    task: "Copy the entire final status line of output after git switch -m mytopic showing changes to frotz. Preserve the tab.",
    expected: "0-1443",
    candidates: [
      candidate(
        "0-1443",
        "Carrying local changes, command and output",
        output,
        output.split("\n").at(-1),
      ),
      candidate("0-1432", "Previous example, command errors out", dom(git, "0-1432")),
    ],
  },
];

for (const { name, expected, candidates } of cases) {
  const ids = candidates.map((source) => source.id);
  assert.equal(ids.length, new Set(ids).size, name);
  assert(expected === "none" || ids.includes(expected), name);
  if (!live) console.log(JSON.stringify({ name, expected, candidates }));
}
if (!live) process.exit(0);

const models = ["pplx-decider-v1.3", "pplx-decider-flash-v1.3"];
const arms = ["choice-check", "locate"];
const queue = cases.flatMap((entry, index) =>
  models.flatMap((model, modelIndex) =>
    ((index + modelIndex) % 2 ? arms.toReversed() : arms).map((arm) => ({ entry, model, arm })),
  ),
);
let next = 0;
async function work() {
  for (let trial = queue[next++]; trial; trial = queue[next++]) {
    const { entry, model, arm } = trial;
    const { name, task, candidates, expected } = entry;
    const desired = candidates.find(({ id }) => id === expected);
    const config = { apiKey: apiKey!, model, signal: AbortSignal.timeout(8_000) };
    let sheet = "";
    const spans = candidates.map(({ id, scope, text, value }) => {
      sheet += `[${id}] ${scope}\n`;
      const start = Array.from(sheet + text.slice(0, text.indexOf(value))).length;
      sheet += text + "\n\n";
      return { id, value, start, end: start + Array.from(value).length };
    });
    const points = Array.from(sheet);
    const started = performance.now();
    try {
      if (arm === "locate") {
        const result = await decide(config, sheet, {
          value: {
            type: "locate",
            instructions: `${task} Return a single contiguous span in the given text. Omit the value if absent.`,
          },
        });
        const answer = result.answers.value;
        assert(answer?.type === "locate");
        const first = answer.spans.toSorted((a, b) => b.score - a.score)[0];
        const matched =
          first &&
          spans.find(
            ({ start, end, value }) =>
              first.start === start &&
              first.end === end &&
              points.slice(start, end).join("") === first.text &&
              first.text === value,
          );
        const rawCorrect = desired ? first?.text === desired.value : !first;
        const decision = matched?.id ?? "none";
        console.log(
          JSON.stringify({
            name,
            model,
            arm,
            expected,
            decision,
            rawCorrect,
            correct: decision === expected,
            first,
            spans,
            ms: Math.round(performance.now() - started),
            usage: result.usage,
          }),
        );
      } else {
        const questions: Record<string, DecisionQuestion> = {
          choice: {
            type: "choice",
            instructions: task,
            criteria: {
              ...Object.fromEntries(candidates.map(({ id, value }) => [id, JSON.stringify(value)])),
              none: "No supplied span satisfies the request",
            },
          },
        };
        for (const { id, value } of candidates) {
          questions[`check_${id}`] = {
            type: "noul",
            instructions: `Task: ${task}\nDoes the literal span ${JSON.stringify(value)} at source ${id} itself answer the task in full, including its scope, precision, and formatting?`,
          };
        }
        const result = await decide(config, sheet, questions);
        const choice = result.answers.choice;
        assert(choice?.type === "choice");
        const checks = Object.fromEntries(
          candidates.map(({ id }) => {
            const check = result.answers[`check_${id}`];
            return [id, check?.type === "noul" ? check.noul : null];
          }),
        );
        const supported = Object.entries(checks).filter(
          ([, score]) => score !== null && score >= 0.5,
        );
        const decision =
          supported.length === 1 && supported[0]?.[0] === choice.choice ? choice.choice : "none";
        console.log(
          JSON.stringify({
            name,
            model,
            arm,
            expected,
            decision,
            raw: choice.choice,
            checks,
            correct: decision === expected,
            ms: Math.round(performance.now() - started),
            usage: result.usage,
          }),
        );
      }
    } catch (error) {
      console.log(
        JSON.stringify({
          name,
          model,
          arm,
          expected,
          error:
            error instanceof DecisionRequestError ? (error.status ?? error.name) : "local_error",
          ms: Math.round(performance.now() - started),
        }),
      );
    }
  }
}
await Promise.all([work(), work()]);
