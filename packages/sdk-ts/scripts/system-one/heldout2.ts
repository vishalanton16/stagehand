import { z } from "zod/v4";
import { gradeFields, gradeList, similar, type CorpusTask } from "./corpus.js";

/**
 * Second held-out set, added after the first one was used to fix bugs.
 * Graders were written from the captured snapshots before any arm ran, and
 * map-and-copy was not changed after the first run on them.
 */
const loose = (actual: unknown, expected: string) =>
  typeof actual === "number" ? actual === Number(expected) : similar(actual, expected);
const contains = (actual: unknown, expected: string) =>
  typeof actual === "string" ? actual.includes(expected) : actual === Number(expected);

export const heldout2Tasks: CorpusTask[] = [
  {
    name: "hockey_teams",
    kind: "list",
    url: "https://www.scrapethissite.com/pages/forms/",
    instruction: "Extract every team row in the table with team name, year, wins and losses.",
    schema: z.object({
      teams: z.array(z.object({ team: z.string(), year: z.number(), wins: z.number(), losses: z.number() })),
    }),
    grade: (data) => gradeList(data.teams, { length: 25, first: { team: "Boston Bruins", year: "1990", wins: "44", losses: "24" }, last: { team: "Chicago Blackhawks", year: "1991", wins: "36", losses: "29" }, compare: loose }),
  },
  {
    name: "tallest_buildings",
    kind: "list",
    url: "https://en.wikipedia.org/wiki/List_of_tallest_buildings",
    instruction: "Extract the 5 tallest buildings with their name and height in metres.",
    schema: z.object({
      buildings: z.array(z.object({ name: z.string(), height_m: z.number() })),
    }),
    grade: (data) => gradeList(data.buildings, { length: 5, first: { name: "Burj Khalifa", height_m: "828" }, last: { name: "Ping An Finance Center", height_m: "599.1" }, compare: loose }),
  },
  {
    name: "pypi_requests",
    kind: "scalar",
    url: "https://pypi.org/project/requests/",
    instruction: "Extract the latest version number and the required Python version of this package.",
    schema: z.object({ version: z.string(), requires_python: z.string() }),
    grade: (data) => gradeFields(data, { version: "2.34.2", requires_python: "3.10" }, contains),
  },
  {
    name: "lobsters",
    kind: "list",
    url: "https://lobste.rs/",
    instruction: "Extract the title and score of every story on the front page.",
    schema: z.object({ stories: z.array(z.object({ title: z.string(), score: z.number() })) }),
    grade: (data) => gradeList(data.stories, { length: 25, first: { title: "How Not to Build a Music Player", score: "60" }, compare: loose }),
  },
  {
    name: "books_travel",
    kind: "list",
    url: "https://books.toscrape.com/catalogue/category/books/travel_2/index.html",
    instruction: "Extract every book in this category with its title, price and availability.",
    schema: z.object({
      books: z.array(z.object({ title: z.string(), price: z.string(), availability: z.string() })),
    }),
    grade: (data) => gradeList(data.books, { length: 11, first: { title: "It's Only the Himalayas", price: "£45.17", availability: "In stock" }, last: { title: "1,000 Places to See", price: "£26.08" }, compare: contains }),
  },
  {
    name: "eiffel_infobox",
    kind: "scalar",
    url: "https://en.wikipedia.org/wiki/Eiffel_Tower",
    instruction: "Extract the year construction started and the year construction was completed.",
    schema: z.object({ construction_started: z.number(), completed: z.number() }),
    grade: (data) => gradeFields(data, { construction_started: 1887, completed: 1889 }),
  },
  {
    name: "python_events",
    kind: "list",
    url: "https://www.python.org/",
    instruction: "Extract the upcoming events with their date and title.",
    schema: z.object({ events: z.array(z.object({ date: z.string(), title: z.string() })) }),
    grade: (data) => gradeList(data.events, { length: 5, first: { date: "11-14", title: "PyCon Hong Kong 2026" }, compare: contains }),
  },
  {
    name: "mdn_status",
    kind: "list",
    url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status",
    instruction: "Extract every HTTP status code listed with its name, e.g. 404 Not Found.",
    schema: z.object({ statuses: z.array(z.object({ code: z.number(), name: z.string() })) }),
    grade: (data) => gradeList(data.statuses, { length: 63, first: { code: "100", name: "Continue" }, last: { code: "511", name: "Network Authentication Required" }, compare: loose }),
  },
  {
    name: "webscraper_ecommerce",
    kind: "list",
    url: "https://webscraper.io/test-sites/e-commerce/allinone",
    instruction: "Extract the featured products with name, price and description.",
    schema: z.object({
      products: z.array(z.object({ name: z.string(), price: z.string(), description: z.string() })),
    }),
    grade: (data) => gradeList(data.products, { length: 3, first: { name: "Dell Latitude", price: "$1178.19", description: "Dell Latitude 5580" }, compare: contains }),
  },
  // npm_zod dropped: npmjs.com served a bot checkpoint to the capture browser.
];
