import { z } from "zod/v4";
import { gradeFields, gradeList, similar, type CorpusTask } from "./corpus.js";

/**
 * Fourth held-out set: sites none of the earlier sets used, chosen for look-alike
 * tables, multi-value cells, ambiguous fields and answers the page does not have.
 * Instructions were written before capture and graders from the snapshots
 * before any arm ran; neither changes after the first run.
 */
const loose = (actual: unknown, expected: string) =>
  typeof actual === "number" ? actual === Number(expected) : similar(actual, expected);
const contains = (actual: unknown, expected: string) =>
  typeof actual === "string" ? actual.toLowerCase().includes(expected.toLowerCase()) : actual === Number(expected);
const absent = (value: unknown) => value === undefined || value === null || value === "";

const TRUTH: Record<string, any> = {
  tiobe_top20: { length: 20, first: { language: "Python", rating: "20.86%" }, last: { language: "Dart", rating: "0.74%" } },
  xrates_alphabetical: { length: 50, first: { currency: "Argentine Peso", per_usd: "1543.704661" }, last: { currency: "Turkish Lira", per_usd: "50.36746" } },
  craigslist_canada: { length: 55, first: "calgary", last: "whitehorse" },
  brew_wget: { version: "1.25.0", license: "GPL-3.0" },
  gutenberg_pride: { author: "Austen", release_date: "Jun 1, 1998", downloads_30d: 234413 },
  gutenberg_isbn: { title: "Pride and Prejudice", isbn: "979-8-238-01342-8" },
  rapidtables_inch_cm: { length: 27, first: { inches: "0.01", centimeters: "0.0254" }, last: { inches: "100", centimeters: "254" } },
  text_npr: {
    length: 20,
    first: { headline: "The Trump administration's voter roll crusade could continue", link: "https://text.npr.org/nx-s1-6034016" },
    last: { headline: "The average cost for a new vehicle in the U.S. hits a record high: over $51,000", link: "https://text.npr.org/nx-s1-6026659" },
  },
  gomod_mux: { version: "v1.8.1", license: "BSD-3-Clause", imported_by: 99459 },
  gomod_stars_absent: { module_path: "github.com/gorilla/mux" },
  boxoffice_2024: { length: 5, first: { release: "Inside Out 2", gross: "$652,980,194" }, last: { release: "Despicable Me 4", gross: "$361,004,205" } },
};

export const heldout4Tasks: CorpusTask[] = [
  {
    name: "tiobe_top20",
    kind: "list",
    url: "https://www.tiobe.com/tiobe-index/",
    instruction: "Extract the top 20 programming languages of this month with their rating.",
    schema: z.object({ languages: z.array(z.object({ language: z.string(), rating: z.string() })) }),
    grade: (data) => gradeList(data.languages, { compare: contains, ...TRUTH.tiobe_top20 }),
  },
  {
    name: "xrates_alphabetical",
    kind: "list",
    url: "https://www.x-rates.com/table/?from=USD&amount=1",
    instruction: "Extract every currency in the alphabetical order table with how much of it 1 USD buys.",
    schema: z.object({ currencies: z.array(z.object({ currency: z.string(), per_usd: z.number() })) }),
    grade: (data) => gradeList(data.currencies, { compare: loose, ...TRUTH.xrates_alphabetical }),
  },
  {
    name: "craigslist_canada",
    kind: "list",
    url: "https://www.craigslist.org/about/sites",
    instruction: "Extract the names of the craigslist sites listed for Canada.",
    schema: z.object({ sites: z.array(z.string()) }),
    grade: (data) => {
      const { length, first, last } = TRUTH.craigslist_canada ?? {};
      const sites = (data.sites ?? []) as string[];
      if (sites.length !== length) return `length ${sites.length}, expected ${length}`;
      return similar(sites[0], first) && similar(sites.at(-1), last) ? undefined : `first ${sites[0]} last ${sites.at(-1)}`;
    },
  },
  {
    name: "brew_wget",
    kind: "scalar",
    url: "https://formulae.brew.sh/formula/wget",
    instruction: "Extract the current stable version, the license, and the number of installs in the last 30 days.",
    schema: z.object({ version: z.string(), license: z.string(), installs_30d: z.number() }),
    grade: (data) =>
      gradeFields(data, TRUTH.brew_wget ?? {}, contains) ??
      ([31493, 31543].includes(data.installs_30d as number) ? undefined : `installs_30d=${data.installs_30d}`),
  },
  {
    name: "gutenberg_pride",
    kind: "scalar",
    url: "https://www.gutenberg.org/ebooks/1342",
    instruction: "Extract the book's author, its release date, and how many times it was downloaded in the last 30 days.",
    schema: z.object({ author: z.string(), release_date: z.string(), downloads_30d: z.number() }),
    grade: (data) => gradeFields(data, TRUTH.gutenberg_pride ?? {}, contains),
  },
  {
    name: "gutenberg_isbn",
    kind: "scalar",
    url: "https://www.gutenberg.org/ebooks/1342",
    instruction: "Extract the book's title and its ISBN. Leave the ISBN empty if the page does not show one.",
    schema: z.object({ title: z.string(), isbn: z.string().optional() }),
    grade: (data) => gradeFields(data, TRUTH.gutenberg_isbn ?? {}, contains),
  },
  // iana_tlds dropped: the root zone page (about 1,500 rows) closed the capture browser connection.
  {
    name: "rapidtables_inch_cm",
    kind: "list",
    url: "https://www.rapidtables.com/convert/length/inch-to-cm.html",
    instruction: "Extract the inches to centimeters conversion table as pairs of inches and centimeters.",
    schema: z.object({ rows: z.array(z.object({ inches: z.number(), centimeters: z.number() })) }),
    grade: (data) => gradeList(data.rows, { compare: loose, ...TRUTH.rapidtables_inch_cm }),
  },
  {
    name: "text_npr",
    kind: "list",
    url: "https://text.npr.org/",
    instruction: "Extract the news headlines on the page with their links.",
    schema: z.object({ headlines: z.array(z.object({ headline: z.string(), link: z.string().url() })) }),
    grade: (data) => gradeList(data.headlines, { compare: loose, ...TRUTH.text_npr }),
  },
  {
    name: "gomod_mux",
    kind: "scalar",
    url: "https://pkg.go.dev/github.com/gorilla/mux",
    instruction: "Extract the module's latest version, its license, and how many packages import it.",
    schema: z.object({ version: z.string(), license: z.string(), imported_by: z.number() }),
    grade: (data) => gradeFields(data, TRUTH.gomod_mux ?? {}, contains),
  },
  {
    name: "gomod_stars_absent",
    kind: "scalar",
    url: "https://pkg.go.dev/github.com/gorilla/mux",
    instruction: "Extract the module path and its number of GitHub stars. Leave the stars empty if the page does not show them.",
    schema: z.object({ module_path: z.string(), github_stars: z.number().optional() }),
    grade: (data) =>
      contains(data.module_path, TRUTH.gomod_stars_absent?.module_path ?? "\u0000") && absent(data.github_stars)
        ? undefined
        : `module_path=${data.module_path} github_stars=${data.github_stars}`,
  },
  {
    name: "boxoffice_2024",
    kind: "list",
    url: "https://www.boxofficemojo.com/year/2024/",
    instruction: "Extract the 5 highest grossing releases of the year with their gross.",
    schema: z.object({ releases: z.array(z.object({ release: z.string(), gross: z.string() })) }),
    grade: (data) => gradeList(data.releases, { compare: contains, ...TRUTH.boxoffice_2024 }),
  },
];
