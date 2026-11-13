import { z } from "zod/v4";
import { gradeFields, gradeList, similar, site, type CorpusTask } from "./corpus.js";

/** Numbers must match exactly, text fuzzily (the eval graders' similarity). */
const loose = (actual: unknown, expected: string) =>
  typeof actual === "number" ? actual === Number(expected) : similar(actual, expected);
const contains = (actual: unknown, expected: string) => typeof actual === "string" && actual.includes(expected);

/**
 * Tasks never looked at while building map-and-copy: the five extract evals
 * not in corpus.ts, plus fresh public pages. Graders were written from the
 * captured snapshot before any arm ran on them.
 */
export const heldoutTasks: CorpusTask[] = [
  {
    name: "github_stars",
    kind: "scalar",
    url: "https://github.com/facebook/react",
    instruction: "Extract the number of stars for the project",
    schema: z.object({ stars: z.number().describe("the number of stars for the project") }),
    grade: (data) => (typeof data.stars === "number" && Math.abs(data.stars - 253_000) <= 1000 ? undefined : `stars=${data.stars}`),
  },
  {
    name: "repo_name",
    kind: "scalar",
    url: "https://github.com/facebook/react",
    instruction: "extract the title of the Github repository. Do not include the owner of the repository.",
    schema: z.object({ extraction: z.string() }),
    grade: (data) => gradeFields(data, { extraction: "react" }, (a, e) => a === e),
  },
  {
    name: "geniusee_2",
    kind: "scalar",
    url: site("geniusee"),
    scope: "/html/body/main/div[2]/div[2]/div[2]/table/tbody/tr[9]",
    instruction: "Extract the scalability comment in the table for Gemini (Google)",
    schema: z.object({ scalability: z.string() }),
    // The scoped row is "Known applications"; the eval only checks nothing leaks in from other rows.
    grade: (data) =>
      data.scalability === "Scalable architecture with API access" ? "leaked a comment from outside the scope" : undefined,
  },
  {
    name: "aigrant_2",
    kind: "scalar",
    url: site("aigrant"),
    scope: "/html/body/div/ul[5]/li[28]",
    instruction: "Extract the name of the company that comes after 'Coframe'.",
    schema: z.object({ company_name: z.string() }),
    grade: (data) => (data.company_name === "OpusClip" ? "leaked OpusClip from outside the scope" : undefined),
  },
  // apartments.com serves a bot wall to headless Chrome (441-char snapshot); kept for reference.
  {
    name: "apartments",
    kind: "list",
    url: "https://www.apartments.com/san-francisco-ca/2-bedrooms/",
    instruction: "Extract all the apartment listings with their prices and their addresses.",
    schema: z.object({
      listings: z.array(
        z.object({
          price: z.string().describe("The price of the listing"),
          address: z.string().describe("The address of the listing"),
        }),
      ),
    }),
    grade: (data) => gradeList(data.listings, { length: 40, atLeast: true }),
  },
  {
    name: "hacker_news",
    kind: "list",
    url: "https://news.ycombinator.com/",
    instruction: "Extract the title and points of every story on the page.",
    schema: z.object({
      stories: z.array(z.object({ title: z.string(), points: z.number() })),
    }),
    grade: (data) => gradeList(data.stories, { length: 30, first: { title: '"LibreOffice works 365 days a year. Just saying."', points: "223" }, compare: loose }),
  },
  {
    name: "wiki_population",
    kind: "list",
    url: "https://en.wikipedia.org/wiki/List_of_countries_and_dependencies_by_population",
    instruction: "Extract the 10 most populous countries with their population.",
    schema: z.object({
      countries: z.array(z.object({ country: z.string(), population: z.number() })),
    }),
    grade: (data) => gradeList(data.countries, { length: 10, first: { country: "India", population: "1429404000" }, last: { country: "Mexico", population: "131231919" }, compare: loose }),
  },
  {
    name: "books_toscrape",
    kind: "list",
    url: "https://books.toscrape.com/",
    instruction: "Extract every book on the page with its title and price.",
    schema: z.object({
      books: z.array(z.object({ title: z.string(), price: z.string() })),
    }),
    grade: (data) => gradeList(data.books, { length: 20, first: { title: "A Light in the", price: "£51.77" }, compare: (a, e) => contains(a, e) }),
  },
  {
    name: "quotes_toscrape",
    kind: "list",
    url: "https://quotes.toscrape.com/",
    instruction: "Extract every quote on the page with its author.",
    schema: z.object({
      quotes: z.array(z.object({ quote: z.string(), author: z.string() })),
    }),
    grade: (data) => gradeList(data.quotes, { length: 10, first: { author: "Albert Einstein" }, last: { quote: "“A day without sunshine is like, you know, night.”", author: "Steve Martin" }, compare: loose }),
  },
  {
    name: "python_releases",
    kind: "list",
    url: "https://www.python.org/downloads/",
    instruction: "Extract the version and release date of every Python release in the release list.",
    schema: z.object({
      releases: z.array(z.object({ version: z.string(), release_date: z.string() })),
    }),
    grade: (data) => gradeList(data.releases, { length: 200, atLeast: true, first: { version: "3.15.2", release_date: "Oct. 25, 2026" }, compare: contains }),
  },
  {
    name: "scrapethissite_countries",
    kind: "list",
    url: "https://www.scrapethissite.com/pages/simple/",
    instruction: "Extract every country with its capital, population and area.",
    schema: z.object({
      countries: z.array(
        z.object({ name: z.string(), capital: z.string(), population: z.number(), area: z.number() }),
      ),
    }),
    grade: (data) => gradeList(data.countries, { length: 250, first: { name: "Andorra", capital: "Andorra la Vella", population: "84000", area: "468" }, last: { name: "Zimbabwe", capital: "Harare", population: "11651858", area: "390580" }, compare: loose }),
  },
  {
    name: "wiki_python_infobox",
    kind: "scalar",
    url: "https://en.wikipedia.org/wiki/Python_(programming_language)",
    instruction: "Extract who designed Python and the year it first appeared.",
    schema: z.object({ designer: z.string(), first_appeared: z.number() }),
    grade: (data) => gradeFields(data, { designer: "Guido van Rossum", first_appeared: 1991 }),
  },
];
