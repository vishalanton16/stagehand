import { createHash } from "node:crypto";
import { z } from "zod/v4";
import type { CorpusTask } from "./corpus.js";

// GNU Units returned HTTP throttling and W3C CSS Color closed the browser connection.
// Replacements have separately captured pages, with instructions fixed before capture.
export const heldout5Tasks: CorpusTask[] = [
  {
    name: "hold5_sqlite_limits",
    url: "https://www.sqlite.org/limits.html",
    kind: "scalar",
    instruction:
      "Extract the default maximum number of columns and the hard upper bound on that number.",
    schema: z.object({ defaultColumns: z.number(), upperBound: z.number() }),
    grade: (data) =>
      data.defaultColumns === 2000 && data.upperBound === 32767 ? undefined : "wrong column limits",
  },
  {
    name: "hold5_rfc_absence",
    url: "https://www.rfc-editor.org/rfc/rfc2119.html",
    kind: "scalar",
    instruction:
      "Extract the RFC number, the month and year it was published, and a DOI only if this document explicitly shows one.",
    schema: z.object({ rfc: z.number(), published: z.string(), doi: z.string().optional() }),
    grade: (data) =>
      data.rfc === 2119 && /^march\s+1997$/i.test(data.published ?? "") && data.doi === undefined
        ? undefined
        : "incorrect RFC details or DOI",
  },
  {
    name: "hold5_nist_temp",
    url: "https://www.nist.gov/pml/owm/si-units-temperature",
    kind: "scalar",
    instruction:
      "Extract the freezing point of water in degrees Celsius and kelvins as given on the page.",
    schema: z.object({ celsius: z.number(), kelvins: z.number() }),
    grade: (data) =>
      data.celsius === 0 && data.kelvins === 273.15 ? undefined : "wrong freezing point",
  },
  {
    name: "hold5_html_tables",
    url: "https://www.w3schools.com/html/html_tables.asp",
    kind: "list",
    instruction:
      "From the example table with Company, Contact, and Country columns, extract all company and country pairs in order.",
    schema: z.object({ rows: z.array(z.object({ company: z.string(), country: z.string() })) }),
    grade: (data) =>
      JSON.stringify(
        data.rows?.map(({ company, country }: { company: string; country: string }) => [
          company,
          country,
        ]),
      ) ===
      JSON.stringify([
        ["Alfreds Futterkiste", "Germany"],
        ["Centro comercial Moctezuma", "Mexico"],
        ["Ernst Handel", "Austria"],
        ["Island Trading", "UK"],
        ["Laughing Bacchus Winecellars", "Canada"],
        ["Magazzini Alimentari Riuniti", "Italy"],
      ])
        ? undefined
        : "wrong company/country rows",
  },
  {
    name: "hold5_postgres_sections",
    url: "https://www.postgresql.org/docs/current/tutorial.html",
    kind: "list",
    instruction:
      "List the lesson titles under The SQL Language in chapter order. Omit their section numbers and the chapter title itself.",
    schema: z.object({ lessons: z.array(z.string()) }),
    grade: (data) =>
      JSON.stringify(data.lessons?.map((value: string) => value.toLowerCase())) ===
      JSON.stringify([
        "introduction",
        "concepts",
        "creating a new table",
        "populating a table with rows",
        "querying a table",
        "joins between tables",
        "aggregate functions",
        "updates",
        "deletions",
      ])
        ? undefined
        : "wrong SQL lesson titles",
  },
  {
    name: "hold5_tld_list",
    url: "https://data.iana.org/TLD/tlds-alpha-by-domain.txt",
    kind: "list",
    instruction:
      "Extract all top-level domain labels in the source, in the order shown. Leave out the version comment.",
    schema: z.object({ labels: z.array(z.string()) }),
    grade: (data) => {
      if (
        !Array.isArray(data.labels) ||
        data.labels.length !== 1436 ||
        !data.labels.every(
          (label: unknown) => typeof label === "string" && /^[A-Z0-9-]+$/.test(label),
        )
      )
        return "wrong domain count or format";
      const hash = createHash("sha256").update(data.labels.join("\n")).digest("hex");
      return hash === "19f58d9d8a1a9be84c1a4e5aa4c64c304ed260d1dc241bf1d42b42c4ccd39d43"
        ? undefined
        : "wrong domain labels or ordering";
    },
  },
];
