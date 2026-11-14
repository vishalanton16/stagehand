import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { CORPUS_DIR } from "./capture.js";

const fixtures = [
  {
    name: "monthly-annual",
    sheet:
      "Pro plan | USD 29 per month when billed annually | USD 39 per month when billed monthly",
    fields: {
      monthly:
        "Monthly price of the Pro plan when billed monthly. Copy just the amount as written.",
    },
    expected: { monthly: "39" },
  },
  {
    name: "inferred-edition",
    sheet: "Title: Economics 2.0\nAuthor: Dana Lee\nPublished: 2025",
    fields: {
      edition: "Explicitly labeled edition number. A number in the title is insufficient.",
    },
    expected: { edition: null },
  },
  {
    name: "zero-and-absence",
    sheet: "Open issues: 0\nClosed issues: 19\nStars: 44",
    fields: {
      open: "Open issue count. Copy just the number.",
      forks: "Number of forks. Copy just the number.",
    },
    expected: { open: "0", forks: null },
  },
  {
    name: "adjacent-records",
    sheet:
      "Requests | Requires Python >=3.10 | version 2.32.5\nHTTPX | Requires Python >=3.8 | version 0.28.1",
    fields: { python: "Minimum Python version for Requests. Copy just the version, without >=." },
    expected: { python: "3.10" },
  },
  {
    name: "unit-direction",
    sheet: "USD / EUR rates | 1 USD buys 0.91 EUR | 1 EUR buys 1.10 USD",
    fields: { euros: "Euros bought by one USD. Copy just the amount as written." },
    expected: { euros: "0.91" },
  },
  {
    name: "distinct-overlapping-spans",
    sheet: "Project: Atlas\nLicense: MIT\nCurrent version: 1.4.0\nPrevious version: 1.3.0",
    fields: {
      name: "Project name only.",
      license: "Current license identifier only.",
      version: "Current version only.",
    },
    expected: { name: "Atlas", license: "MIT", version: "1.4.0" },
  },
  {
    name: "unicode-prefix",
    sheet: "Équipe 🚀\nHeadquarters: Montréal\nOther office: Toronto",
    fields: { city: "Headquarters city only." },
    expected: { city: "Montréal" },
  },
  {
    name: "unprinted-value",
    sheet: "Unit price: 12 USD\nQuantity: 7 units\nShipping: 4 USD",
    fields: {
      total:
        "Explicitly stated line total before shipping. Return nothing if the total is not printed. Do not calculate it.",
    },
    expected: { total: null },
  },
] satisfies {
  name: string;
  sheet: string;
  fields: Record<string, string>;
  expected: Record<string, string | null>;
}[];

type Span = { text: string; start: number; end: number; score: number };
type ClairicField = { value: string | number | null; span?: [number, number]; p_null?: number };
type Usage = {
  input_tokens: number;
  output_tokens: number;
  state_tokens?: number;
  passes?: number;
};

const models = [
  "pplx-decider-v1.3",
  "pplx-decider-flash-v1.3",
  "clairic",
  "clairic-typed",
] as const;
const numericFields: Record<string, string[]> = {
  "monthly-annual": ["monthly"],
  "inferred-edition": ["edition"],
  "zero-and-absence": ["open", "forks"],
  "unit-direction": ["euros"],
  "unprinted-value": ["total"],
};
const id = randomUUID();
const archive = new URL(`runs/scalar-probes/${id}/`, CORPUS_DIR);
mkdirSync(archive, { recursive: true });
const manifest = {
  id,
  revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  models,
  fixtures,
};
writeFileSync(new URL("manifest.json", archive), JSON.stringify(manifest, null, 2));
process.stderr.write(JSON.stringify({ id }) + "\n");

const jobs = fixtures.flatMap((fixture) => models.map((model) => ({ fixture, model })));
for (const { fixture, model } of jobs) {
  const cloudflare = model.startsWith("clairic");
  const url = cloudflare
    ? `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID!)}/ai/run/@cf/cloudflare/clairic`
    : "https://api.perplexity.ai/v1/decisions";
  const apiKey = cloudflare ? process.env.CLOUDFLARE_AUTH_TOKEN : process.env.PERPLEXITY_API_KEY;
  const fields = Object.fromEntries(
    Object.entries(fixture.fields).map(([name, instructions]) => [
      name,
      {
        type:
          model === "clairic-typed" && numericFields[fixture.name]?.includes(name)
            ? "number"
            : cloudflare
              ? "text"
              : "locate",
        instructions,
      },
    ]),
  );
  const start = performance.now();
  let result;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: cloudflare ? "clairic" : model,
        state: fixture.sheet,
        ...(cloudflare ? { fields } : { questions: fields }),
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    const payload = (cloudflare ? body.result : body) as {
      answers: Record<string, ClairicField | { spans: Span[] }>;
      usage: Usage;
      truncated?: boolean;
    };
    const spans = new Map<string, { start: number; end: number; text: string }>();
    const values = Object.fromEntries(
      Object.keys(fixture.fields).map((name) => {
        const answer = payload.answers[name];
        if (!answer) throw new Error(`Missing answer for ${name}`);
        if ("spans" in answer) {
          const best = answer.spans.toSorted((a, b) => b.score - a.score)[0];
          if (best) spans.set(name, best);
          return [name, best?.text ?? null];
        }
        if (answer.span && typeof answer.value === "string") {
          spans.set(name, { start: answer.span[0], end: answer.span[1], text: answer.value });
        }
        return [name, answer.value];
      }),
    );
    const codePoints = Array.from(fixture.sheet);
    const offsetMatches = Object.fromEntries(
      [...spans].map(([name, { start, end, text }]) => [
        name,
        codePoints.slice(start, end).join("") === text,
      ]),
    );
    result = {
      values,
      passed: Object.entries(fixture.expected).every(
        ([key, value]) =>
          values[key] === value ||
          (typeof values[key] === "number" && String(values[key]) === value),
      ),
      offsetMatches,
      answers: payload.answers,
      usage: payload.usage,
      truncated: payload.truncated,
    };
  } catch (error) {
    result = { error: error instanceof Error ? error.message.slice(0, 180) : String(error) };
  }
  const line =
    JSON.stringify({
      model,
      task: fixture.name,
      expected: fixture.expected,
      ...result,
      ms: Math.round(performance.now() - start),
    }) + "\n";
  appendFileSync(new URL("results.jsonl", archive), line);
  process.stdout.write(line);
}
