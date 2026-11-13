import { z } from "zod/v4";
import { gradeFields, gradeList, similar, type CorpusTask } from "./corpus.js";

/**
 * Third held-out set, for the final pipeline and the agreement cascade.
 * Instructions were written before capture, graders from the captured
 * snapshots before any arm ran, and nothing was changed after the first run.
 */
const loose = (actual: unknown, expected: string) =>
  typeof actual === "number" ? actual === Number(expected) : similar(actual, expected);
const contains = (actual: unknown, expected: string) =>
  typeof actual === "string" ? actual.includes(expected) : actual === Number(expected);

const TRUTH: Record<string, any> = {
  webscraper_tables: { length: 3, first: { first_name: "Mark", last_name: "Otto", username: "@mdo" }, last: { first_name: "Larry", last_name: "the Bird", username: "@twitter" } },
  quotes_humor: { length: 10, first: { quote: "The person, be it gentleman or lady", author: "Jane Austen" }, last: { author: "George Carlin" } },
  book_product: { upc: "a897fe39b1053632", price_excl_tax: "51.77", copies_in_stock: 22 },
  hn_show: { length: 30, first: { title: "Isometric SF", points: "29" }, last: { title: "calendar app that gives each event", points: "15" } },
  github_typescript: { stars: 112000, forks: 14700 },
  highest_mountains: { length: 3, first: { name: "Mount Everest", height_m: "8849" }, last: { name: "Kangchenjunga", height_m: "8586" } },
  rubygems_rails: { version: "8.1.4.1", license: "MIT" },
  apollo11_infobox: { launch_year: 1969, crew_size: 3, mission_duration: "8 days" },
};

export const heldout3Tasks: CorpusTask[] = [
  {
    name: "webscraper_tables",
    kind: "list",
    url: "https://webscraper.io/test-sites/tables",
    instruction: "Extract the rows of the first table with first name, last name and username.",
    schema: z.object({
      people: z.array(z.object({ first_name: z.string(), last_name: z.string(), username: z.string() })),
    }),
    grade: (data) => gradeList(data.people, { compare: loose, ...TRUTH.webscraper_tables }),
  },
  {
    name: "quotes_humor",
    kind: "list",
    url: "https://quotes.toscrape.com/tag/humor/",
    instruction: "Extract every quote on the page with its author.",
    schema: z.object({ quotes: z.array(z.object({ quote: z.string(), author: z.string() })) }),
    grade: (data) => gradeList(data.quotes, { compare: contains, ...TRUTH.quotes_humor }),
  },
  {
    name: "book_product",
    kind: "scalar",
    url: "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html",
    instruction: "Extract the book's UPC, its price excluding tax, and how many copies are in stock.",
    schema: z.object({ upc: z.string(), price_excl_tax: z.string(), copies_in_stock: z.number() }),
    grade: (data) => gradeFields(data, TRUTH.book_product ?? {}, contains),
  },
  {
    name: "hn_show",
    kind: "list",
    url: "https://news.ycombinator.com/show",
    instruction: "Extract the title and points of every Show HN post on the page.",
    schema: z.object({ posts: z.array(z.object({ title: z.string(), points: z.number() })) }),
    grade: (data) => gradeList(data.posts, { compare: contains, ...TRUTH.hn_show }),
  },
  {
    name: "github_typescript",
    kind: "scalar",
    url: "https://github.com/microsoft/TypeScript",
    instruction: "Extract the number of stars and the number of forks of the repository.",
    schema: z.object({ stars: z.number(), forks: z.number() }),
    grade: (data) => {
      const { stars, forks } = TRUTH.github_typescript ?? {};
      const near = (a: unknown, e: number) => typeof a === "number" && Math.abs(a - e) <= e * 0.01 + 100;
      return near(data.stars, stars) && near(data.forks, forks) ? undefined : `stars=${data.stars} forks=${data.forks}`;
    },
  },
  {
    name: "highest_mountains",
    kind: "list",
    url: "https://en.wikipedia.org/wiki/List_of_highest_mountains_on_Earth",
    instruction: "Extract the 3 highest mountains with their name and height in metres.",
    schema: z.object({ mountains: z.array(z.object({ name: z.string(), height_m: z.number() })) }),
    grade: (data) => gradeList(data.mountains, { compare: loose, ...TRUTH.highest_mountains }),
  },
  {
    name: "rubygems_rails",
    kind: "scalar",
    url: "https://rubygems.org/gems/rails",
    instruction: "Extract the latest version of the gem and its license.",
    schema: z.object({ version: z.string(), license: z.string() }),
    grade: (data) => gradeFields(data, TRUTH.rubygems_rails ?? {}, contains),
  },
  {
    name: "apollo11_infobox",
    kind: "scalar",
    url: "https://en.wikipedia.org/wiki/Apollo_11",
    instruction: "Extract the launch year, the number of crew members, and the mission duration.",
    schema: z.object({ launch_year: z.number(), crew_size: z.number(), mission_duration: z.string() }),
    grade: (data) => gradeFields(data, TRUTH.apollo11_infobox ?? {}, contains),
  },
  // us_holidays dropped: timeanddate.com served a bot checkpoint to the capture browser.
  {
    name: "python_docs_versions",
    kind: "list",
    url: "https://docs.python.org/3/",
    instruction: "Extract the documentation sections listed on the page with their title and link.",
    schema: z.object({ sections: z.array(z.object({ title: z.string(), link: z.string().url() })) }),
    grade: (data) => {
      const sections = data.sections ?? [];
      const titles = sections.map((s: { title: string }) => s.title);
      const core = ["Tutorial", "Library reference", "Language reference"];
      const missing = core.filter((t) => !titles.some((x: string) => similar(x, t)));
      if (missing.length || sections.length < 10 || sections.length > 40) return `n=${sections.length} missing=${missing.join(",")}`;
      return sections.every((s: { link: string }) => /^https?:\/\//.test(s.link)) ? undefined : "bad links";
    },
  },
];
