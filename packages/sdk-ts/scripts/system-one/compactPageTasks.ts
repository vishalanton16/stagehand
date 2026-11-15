import { isDeepStrictEqual } from "node:util";
import { z } from "zod/v4";

type Category = "pricing" | "catalog" | "reference" | "prose";
function task(
  name: string,
  category: Category,
  instruction: string,
  schema: z.ZodType,
  expected: Record<string, unknown>,
) {
  return {
    name: `compact_${name}`,
    category,
    instruction,
    schema,
    expected,
    grade: (data: unknown) => isDeepStrictEqual(data, expected),
  };
}

// Graders use only the frozen browser captures, before the first model request.
export const compactPageTasks = [
  task(
    "supabase",
    "pricing",
    "In the Pro plan card, extract the monthly USD starting price and included monthly active users as numbers.",
    z.object({ monthlyUsd: z.number(), activeUsers: z.number() }),
    { monthlyUsd: 25, activeUsers: 100000 },
  ),
  task(
    "render",
    "pricing",
    "From the compute pricing table, extract the monthly USD prices for 0.5c-512mb and 1c-2g.",
    z.object({ smallMonthly: z.number(), mediumMonthly: z.number() }),
    { smallMonthly: 7, mediumMonthly: 25 },
  ),
  task(
    "fly",
    "pricing",
    "From the rates table, copy the price text for a dedicated IPv4 address and for static egress IP, preserving displayed units and qualifiers.",
    z.object({ ipv4: z.string(), egress: z.string() }),
    { ipv4: "$2/month", egress: "$0.005/hour (~$3.60/month)" },
  ),
  task(
    "railway",
    "pricing",
    "Extract the monthly usage credits included in the Hobby and Pro plan cards, in USD as numbers.",
    z.object({ hobby: z.number(), pro: z.number() }),
    { hobby: 5, pro: 20 },
  ),
  task(
    "scifi",
    "catalog",
    "Extract the first three book cards in page order. Give each full title, listed price with currency symbol, and product page URL. Use the full title available from the card.",
    z.object({ books: z.array(z.object({ title: z.string(), price: z.string(), url: z.url() })) }),
    {
      books: [
        {
          title: "Mesaerion: The Best Science Fiction Stories 1800-1849",
          price: "£37.59",
          url: "https://books.toscrape.com/catalogue/mesaerion-the-best-science-fiction-stories-1800-1849_983/index.html",
        },
        {
          title: "Join",
          price: "£35.67",
          url: "https://books.toscrape.com/catalogue/join_902/index.html",
        },
        {
          title:
            "William Shakespeare's Star Wars: Verily, A New Hope (William Shakespeare's Star Wars #4)",
          price: "£43.30",
          url: "https://books.toscrape.com/catalogue/william-shakespeares-star-wars-verily-a-new-hope-william-shakespeares-star-wars-4_871/index.html",
        },
      ],
    },
  ),
  task(
    "history",
    "catalog",
    "Copy the displayed prices including the currency symbol for the first three History book cards, in page order.",
    z.object({ prices: z.array(z.string()) }),
    { prices: ["£54.23", "£25.52", "£19.73"] },
  ),
  task(
    "brew",
    "catalog",
    "Copy the stable curl formula version and its license as displayed. Also return the official upstream homepage URL.",
    z.object({ version: z.string(), license: z.string(), homepage: z.url() }),
    { version: "8.23.0", license: "curl", homepage: "https://curl.se/" },
  ),
  task(
    "rubygems",
    "catalog",
    "Extract Sinatra's latest release version and copy the Required Ruby Version constraint verbatim.",
    z.object({ version: z.string(), rubyVersion: z.string() }),
    { version: "4.2.1", rubyVersion: ">= 2.7.8" },
  ),
  task(
    "pprint",
    "reference",
    "Extract the numeric defaults for indent and width from the pprint.pprint function signature.",
    z.object({ indent: z.number(), width: z.number() }),
    { indent: 1, width: 80 },
  ),
  task(
    "pathlib",
    "reference",
    "Extract the boolean default for strict in Path.resolve, and the exact name of the method referenced by that signature.",
    z.object({ strict: z.boolean(), method: z.string() }),
    { strict: false, method: "Path.resolve" },
  ),
  task(
    "sqlite_math",
    "reference",
    "Copy the compile-time option including its -D prefix that enables these functions. Also copy the atan2 signature from the function list, keeping argument order and punctuation.",
    z.object({ option: z.string(), signature: z.string() }),
    { option: "-DSQLITE_ENABLE_MATH_FUNCTIONS", signature: "atan2(Y,X)" },
  ),
  task(
    "node_path",
    "reference",
    "From the path.delimiter section, copy only the exact Windows path-list delimiter and the exact POSIX path-list delimiter.",
    z.object({ windows: z.string(), posix: z.string() }),
    { windows: ";", posix: ":" },
  ),
  task(
    "iana_about",
    "prose",
    "In the page's prose, copy the two examples of network identifiers listed together after 'network identifiers like', in page order.",
    z.object({ examples: z.array(z.string()) }),
    { examples: ["domain names", "IP addresses"] },
  ),
  task(
    "python_blurb",
    "prose",
    "Copy the three hyphenated or single-word adjectives that describe Python before 'programming language' in the first sentence, in their original order.",
    z.object({ adjectives: z.array(z.string()) }),
    { adjectives: ["interpreted", "object-oriented", "high-level"] },
  ),
  task(
    "nasa_apollo",
    "prose",
    "Copy Apollo 11's launch and mission end dates from the mission overview. Use the displayed Month Day, Year format.",
    z.object({ launch: z.string(), end: z.string() }),
    { launch: "July 16, 1969", end: "July 24, 1969" },
  ),
  task(
    "debian_about",
    "prose",
    "From the sentence describing how Debian began, copy its starting month and year as printed and the founder's full name. Include a specific start day only if that sentence explicitly states it.",
    z.object({ monthYear: z.string(), founder: z.string(), day: z.number().optional() }),
    { monthYear: "August 1993", founder: "Ian Murdock" },
  ),
];
