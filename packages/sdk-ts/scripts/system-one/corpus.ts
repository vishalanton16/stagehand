import { z } from "zod/v4";

/**
 * Extraction tasks ported from packages/evals/tasks/bench/extract, plus two
 * live pricing pages. Graders mirror the eval graders so a frozen snapshot can
 * be scored without a browser.
 */
export type CorpusTask = {
  name: string;
  url: string;
  /** XPath of the eval's `locator` option; the frozen tree is scoped to it. */
  scope?: string;
  instruction: string;
  schema: z.ZodObject;
  grade: (data: any) => string | undefined;
  kind: "list" | "scalar";
};

export function normalizeString(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[;/#!$%^&*:{}=\-_`~()]/g, "")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatch = new Array<boolean>(a.length).fill(false);
  const bMatch = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - window); j < Math.min(b.length, i + window + 1); j++) {
      if (bMatch[j] || a[i] !== b[j]) continue;
      aMatch[i] = bMatch[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let transpositions = 0;
  for (let i = 0, k = 0; i < a.length; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k++]) transpositions++;
  }
  const jaro =
    (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < Math.min(4, a.length, b.length) && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

export function similar(actual: unknown, expected: string, threshold = 0.9): boolean {
  if (typeof actual !== "string") return false;
  return jaroWinkler(normalizeString(actual), normalizeString(expected)) >= threshold;
}

const same = (actual: unknown, expected: string) =>
  typeof actual === "string" && normalizeString(actual) === normalizeString(expected);

function matchesItem(
  actual: Record<string, unknown> | undefined,
  expected: Record<string, string>,
  compare: (actual: unknown, expected: string) => boolean = same,
): boolean {
  return (
    actual !== undefined &&
    Object.entries(expected).every(([key, value]) => compare(actual[key], value))
  );
}

export function gradeList(
  list: Record<string, unknown>[] | undefined,
  {
    length,
    atLeast = false,
    first,
    last,
    compare,
    anywhere = false,
  }: {
    length: number;
    atLeast?: boolean;
    first?: Record<string, string>;
    last?: Record<string, string>;
    compare?: (actual: unknown, expected: string) => boolean;
    anywhere?: boolean;
  },
): string | undefined {
  if (!Array.isArray(list)) return "no list";
  if (atLeast ? list.length < length : list.length !== length) {
    return `length ${list.length}, expected ${atLeast ? ">=" : ""}${length}`;
  }
  const found = (item: Record<string, string>, index: number) =>
    anywhere
      ? list.some((entry) => matchesItem(entry, item, compare))
      : matchesItem(list[index], item, compare);
  if (first && !found(first, 0)) return `first item ${JSON.stringify(list[0])}`;
  if (last && !found(last, list.length - 1)) return `last item ${JSON.stringify(list.at(-1))}`;
  return undefined;
}

export function gradeFields(
  data: Record<string, unknown>,
  expected: Record<string, unknown>,
  compare: (actual: unknown, expected: string) => boolean = same,
): string | undefined {
  const wrong = Object.entries(expected).filter(([key, value]) =>
    typeof value === "string" ? !compare(data?.[key], value) : data?.[key] !== value,
  );
  return wrong.length
    ? wrong.map(([key, value]) => `${key}=${JSON.stringify(data?.[key])}≠${JSON.stringify(value)}`).join("; ")
    : undefined;
}

export const site = (path: string) => `https://stagehand-eval-sites.vercel.app/sites/${path}/`;

export const tasks: CorpusTask[] = [
  {
    name: "area_codes",
    kind: "list",
    url: site("ncc-area-codes"),
    instruction:
      "Extract ALL the Primary Center names and their corresponding Area Code, and the name of their corresponding Zone.",
    schema: z.object({
      primary_center_list: z.array(
        z.object({
          zone_name: z
            .string()
            .describe(
              "The name of the Zone that the Primary Center is in. For example, 'North Central Zone'.",
            ),
          primary_center_name: z
            .string()
            .describe("The name of the Primary Center. I.e., this is the name of the city or town."),
          area_code: z
            .string()
            .describe("The area code for the Primary Center. This will either be 2 or 3 digits."),
        }),
      ),
    }),
    grade: (data) =>
      gradeList(data.primary_center_list, {
        length: 56,
        first: { zone_name: "Lagos Zone", primary_center_name: "Lagos", area_code: "01" },
        last: { zone_name: "South-East", primary_center_name: "Yenagoa", area_code: "089" },
      }),
  },
  {
    name: "staff_members",
    kind: "list",
    url: site("panamcs"),
    instruction:
      "extract a list of ALL the staff members on this page, with their name and their job title",
    schema: z.object({
      staff_members: z.array(z.object({ name: z.string(), job_title: z.string() })),
    }),
    grade: (data) =>
      gradeList(data.staff_members, {
        length: 50,
        anywhere: true,
        first: { name: "Louis Alvarez", job_title: "School Resource Officer" },
        last: { name: "Jessica Zipin", job_title: "School Based Therapist" },
      }),
  },
  {
    name: "regulations_table",
    kind: "list",
    url: site("ncc-numbering-plan"),
    scope: "/html/body/div[3]/main/div[2]/div[2]/div/div/div[2]/article/div[2]/div[1]/div/table",
    instruction: "Extract ALL of the Allottees and their corresponding name, area, and area code.",
    schema: z.object({
      allottee_list: z.array(
        z.object({
          allottee_name: z.string(),
          area: z.string(),
          area_code: z.string(),
          access_code: z.string(),
        }),
      ),
    }),
    grade: (data) =>
      gradeList(data.allottee_list, {
        length: 25,
        compare: (a, e) => a === e,
        first: {
          allottee_name: "101 Communications Limited",
          area: "Lagos",
          area_code: "0201",
          access_code: "249",
        },
        last: {
          allottee_name: "Airtel Networks Limited",
          area: "National",
          area_code: "0708",
          access_code: "708",
        },
      }),
  },
  {
    name: "csa",
    kind: "list",
    url: site("csa"),
    instruction:
      "Extract all the publications on the page including the publication date, session type, publication type, and annotation",
    schema: z.object({
      publications: z.array(
        z.object({
          publication_date: z.string(),
          session_type: z.string(),
          publication_type: z.string(),
          annotation: z.string(),
        }),
      ),
    }),
    grade: (data) =>
      gradeList(data.publications, {
        length: 14,
        atLeast: true,
        anywhere: true,
        compare: (a, e) => a === e,
        first: {
          publication_date: "11-30-2024",
          session_type: "Regular Session",
          publication_type: "Assembly Weekly History",
          annotation:
            "2024 -- This publication includes the complete histories of second-year bills. The complete electronic history of all bills is always available at leginfo.legislature.ca.gov",
        },
        last: {
          publication_date: "11-30-2016",
          session_type: "1st Extraordinary Session",
          publication_type: "Assembly Weekly History",
          annotation: "",
        },
      }),
  },
  {
    name: "public_notices",
    kind: "list",
    url: site("sars"),
    instruction:
      "Extract ALL the public notice descriptions with their corresponding, GG number and publication date. Extract ALL notices from 2024 through 2020. Do not include the Notice number.",
    schema: z.object({
      public_notices: z.array(
        z.object({
          notice_description: z
            .string()
            .describe("the description of the notice. Do not include the Notice number"),
          gg_number: z.string().describe("the GG number of the notice. For example, GG 12345"),
          publication_date: z
            .string()
            .describe("the publication date of the notice. For example, 8 December 2021"),
        }),
      ),
    }),
    grade: (data) =>
      gradeList(data.public_notices, {
        length: 24,
        compare: (a, e) => similar(a, e),
        first: {
          notice_description:
            "Additional considerations in terms of section 80(2) in respect of which an application for a binding private ruling or a binding class ruling may be rejected",
          gg_number: "GG 51526",
          publication_date: "8 November 2024",
        },
        last: {
          notice_description:
            "Notice in terms of section 25, read with section 66(1) of the Income Tax Act, 1962, for submission of 2020 income tax returns",
          gg_number: "GG 43495",
          publication_date: "3 July 2020",
        },
      }),
  },
  {
    name: "jstor_news",
    kind: "list",
    url: site("jstor"),
    instruction: "Extract ALL the news report titles and their dates.",
    schema: z.object({
      reports: z.array(
        z.object({
          report_name: z.string().describe("The name or title of the news report."),
          publish_date: z.string().describe("The date the news report was published."),
        }),
      ),
    }),
    grade: (data) =>
      gradeList(data.reports, {
        length: 10,
        compare: (a, e) => similar(a, e),
        first: {
          report_name: "JSTOR retires Publisher Sales Service",
          publish_date: "December 9, 2024",
        },
        last: { report_name: "Path to Open announces 2024 titles", publish_date: "May 10, 2024" },
      }),
  },
  {
    name: "jfk_links",
    kind: "list",
    url: site("jfk"),
    instruction: "extract all the record file name and their corresponding links",
    schema: z.object({
      records: z.array(
        z.object({
          file_name: z.string().describe("the file name of the record"),
          link: z.string().url(),
        }),
      ),
    }),
    grade: (data) => {
      const base = "https://www.archives.gov/files/research/jfk/releases/2025/0318/";
      const names = [
        "104-10003-10041.pdf",
        "104-10004-10143 (C06932208).pdf",
        "104-10004-10143.pdf",
        "104-10004-10156.pdf",
        "104-10004-10213.pdf",
        "104-10005-10321.pdf",
        "104-10006-10247.pdf",
        "104-10007-10345.pdf",
        "104-10009-10021.pdf",
        "104-10009-10222.pdf",
      ];
      const records = data.records;
      if (!Array.isArray(records) || records.length !== 10) return `length ${records?.length}`;
      const missing = names.filter(
        (name) =>
          !records.some(
            (r: any) => r.file_name === name && r.link === base + name.replaceAll(" ", "%20"),
          ),
      );
      return missing.length ? `missing ${missing.join(", ")}` : undefined;
    },
  },
  {
    name: "rockauto",
    kind: "list",
    url: site("rockauto"),
    instruction:
      "Extract the part number of all the coolant and antifreeze products in the 'economy' category. Do not include the manufacturer name. Do not include products from the premium category.",
    schema: z.object({ coolant_products: z.array(z.object({ part_number: z.string() })) }),
    grade: (data) => {
      const expected = ["GREEN5050GAL", "719009", "AF3300", "AF3100", "MV5050GAL"];
      const list = data.coolant_products;
      if (!Array.isArray(list) || list.length !== expected.length) return `length ${list?.length}`;
      const missing = expected.filter((part) => !list.some((p: any) => p.part_number === part));
      return missing.length ? `missing ${missing.join(", ")}` : undefined;
    },
  },
  {
    name: "zillow",
    kind: "list",
    url: site("zillow"),
    instruction:
      "Extract EACH AND EVERY HOME PRICE AND ADDRESS ON THE PAGE. DO NOT MISS ANY OF THEM.",
    schema: z.object({
      listings: z.array(
        z.object({
          price: z.string().describe("The price of the home"),
          trails: z.string().describe("The address of the home"),
        }),
      ),
    }),
    grade: (data) => gradeList(data.listings, { length: 38, atLeast: true }),
  },
  {
    name: "memorial_healthcare",
    kind: "list",
    url: site("mycmh"),
    instruction:
      "extract a list of the first three healthcare centers on this page, with their name, full address, and phone number",
    schema: z.object({
      health_centers: z.array(
        z.object({ name: z.string(), phone_number: z.string(), address: z.string() }),
      ),
    }),
    grade: (data) =>
      gradeList(data.health_centers, {
        length: 3,
        compare: (a, e) => similar(a, e),
        first: {
          name: "Community Memorial Breast Center",
          phone_number: "805-948-5093",
          address: "168 North Brent Street, Suite 401, Ventura, CA 93003",
        },
        last: {
          name: "Community Memorial Dermatology and Mohs Surgery",
          phone_number: "805-948-6920",
          address: "168 North Brent Street, Suite 403, Ventura, CA 93003",
        },
      }),
  },
  {
    name: "baptist_health",
    kind: "scalar",
    url: site("baptist-health"),
    instruction: "Extract the address, phone number, and fax number of the healthcare location.",
    schema: z.object({ address: z.string(), phone: z.string(), fax: z.string() }),
    grade: (data) =>
      gradeFields(
        data,
        {
          address: "2055 East South Blvd; Suite 908 Montgomery, AL 36116",
          phone: "334-747-2273",
          fax: "334-747-7501",
        },
        (a, e) => similar(a, e),
      ),
  },
  {
    name: "resistor",
    kind: "scalar",
    url: site("resistor"),
    instruction:
      "Extract the manufacturer standard lead time, tolerance percentage, resistance, and operating temperature range of the resistor.",
    schema: z.object({
      manufacturer_standard_lead_time: z.string(),
      tolerance_percentage: z.string(),
      resistance: z.string(),
      operating_temperature_range: z.string(),
    }),
    grade: (data) =>
      gradeFields(data, {
        manufacturer_standard_lead_time: "11 Weeks",
        tolerance_percentage: "±5",
        resistance: "330 ohms",
        operating_temperature_range: "-55°C ~ 155°C",
      }),
  },
  {
    name: "hamilton_weather",
    kind: "scalar",
    url: site("hamilton-weather"),
    scope: "/html/body[1]/div[5]/main[1]/article[1]/div[6]/div[2]/div[1]/table[1]",
    instruction: "extract the weather data for Sun, Feb 23 at 11PM",
    schema: z.object({
      temperature: z.string(),
      weather_description: z.string(),
      wind: z.string(),
      humidity: z.string(),
      barometer: z.string(),
      visibility: z.string(),
    }),
    grade: (data) =>
      gradeFields(
        data,
        {
          temperature: "27 °F",
          weather_description: "Light snow. Overcast.",
          wind: "6 mph",
          humidity: "93%",
          barometer: '30.07 "Hg',
          visibility: "10 mi",
        },
        (a, e) => similar(a, e),
      ),
  },
  {
    name: "professional_info",
    kind: "scalar",
    url: site("professional-info"),
    instruction: "Extract the list of Practices, phone number, and fax number of the professional.",
    schema: z.object({ practices: z.array(z.string()), phone: z.string(), fax: z.string() }),
    grade: (data) => {
      const practices = [
        "Restructuring",
        "Finance",
        "Hybrid Capital & Special Situations",
        "Private Credit",
      ];
      if (JSON.stringify(data.practices) !== JSON.stringify(practices)) {
        return `practices ${JSON.stringify(data.practices)}`;
      }
      return gradeFields(data, { phone: "+1-212-373-3262", fax: "+1-212-492-0262" });
    },
  },
  {
    name: "recipe",
    kind: "scalar",
    url: site("allrecipes-extract"),
    scope: "/html/body/main/article/div[3]/div[3]/div[4]",
    instruction:
      "Extract the title of the number of tablespoons of olive oil needed for the steak, and the number of teaspoons of lemon juice needed for the mushroom pan sauce.",
    schema: z.object({
      tablespoons_olive_oil: z
        .number()
        .describe("the number of tablespoons of olive oil needed for the steak"),
      teaspoons_lemon_juice: z
        .number()
        .describe("the number of teaspoons of lemon juice needed for the mushroom pan sauce"),
    }),
    grade: (data) => gradeFields(data, { tablespoons_olive_oil: 2, teaspoons_lemon_juice: 2 }),
  },
  {
    name: "aigrant",
    kind: "scalar",
    url: site("aigrant"),
    scope: "/html/body/div/ul[5]/li[28]",
    instruction: "Extract the company name.",
    schema: z.object({ company_name: z.string() }),
    grade: (data) => gradeFields(data, { company_name: "Coframe" }, (a, e) => a === e),
  },
  {
    name: "geniusee",
    kind: "scalar",
    url: site("geniusee"),
    scope: "/html/body/main/div[2]/div[2]/div[2]/table",
    instruction: "Extract the scalability comment in the table for Gemini (Google)",
    schema: z.object({ scalability: z.string() }),
    grade: (data) =>
      gradeFields(data, { scalability: "Scalable architecture with API access" }, (a, e) => a === e),
  },
  {
    name: "single_link",
    kind: "scalar",
    url: site("geniusee"),
    instruction: "extract the link to the 'contact us' page",
    schema: z.object({ link: z.string().url() }),
    grade: (data) =>
      gradeFields(
        data,
        { link: "https://stagehand-eval-sites.vercel.app/sites/geniusee/#contact" },
        (a, e) => a === e,
      ),
  },
  {
    name: "linear_pricing",
    kind: "scalar",
    url: "https://linear.app/pricing",
    instruction: "Find the Basic and Business monthly prices in USD per user when billed annually.",
    schema: z.object({
      basic: z.number().describe("Basic plan monthly USD price per user when billed annually"),
      business: z.number().describe("Business plan monthly USD price per user when billed annually"),
    }),
    grade: (data) => gradeFields(data, { basic: 10, business: 16 }),
  },
  {
    name: "apple_pricing",
    kind: "scalar",
    url: "https://www.apple.com/newsroom/2026/03/apple-introduces-the-new-macbook-air-with-m5/",
    instruction:
      "Extract the US starting prices for the 13-inch and 15-inch MacBook Air with M5. Exclude education prices.",
    schema: z.object({
      price13: z.number().describe("US retail starting price for the 13-inch M5"),
      price15: z.number().describe("US retail starting price for the 15-inch M5"),
    }),
    grade: (data) => gradeFields(data, { price13: 1099, price15: 1299 }),
  },
];
