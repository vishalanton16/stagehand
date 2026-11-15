import { isDeepStrictEqual } from "node:util";
import { z } from "zod/v4";
import type { CorpusTask } from "./corpus.js";

function task(
  name: string,
  url: string,
  instruction: string,
  schema: z.ZodType,
  expected: Record<string, unknown>,
): CorpusTask {
  return {
    name,
    url,
    instruction,
    schema,
    kind: "scalar",
    grade: (data) =>
      isDeepStrictEqual(data, expected) ? undefined : "scalar value or presence mismatch",
  };
}

// Graders derived from public SDK captures before any provider runs.
export const locatePrimaryTasks = [
  task(
    "scalar_httpx",
    "https://pypi.org/project/httpx/",
    "From HTTPX's package metadata, extract the minimum Python version without the comparison operator, and the SPDX license identifier without its surrounding text.",
    z.object({ python: z.string(), license: z.string() }),
    { python: "3.8", license: "BSD-3-Clause" },
  ),
  task(
    "scalar_pep8",
    "https://peps.python.org/pep-0008/",
    "Extract PEP 8's status from its metadata and the default maximum line lengths for code and for docstrings. Use the general recommendation rather than the special allowance for individual teams.",
    z.object({ status: z.string(), codeLineLength: z.number(), docstringLineLength: z.number() }),
    { status: "Active", codeLineLength: 79, docstringLineLength: 72 },
  ),
  task(
    "scalar_github_rates",
    "https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api",
    "Extract the primary rate limits in requests per hour for unauthenticated and personal authenticated requests on GitHub.com. Exclude enterprise and installation limits.",
    z.object({ unauthenticated: z.number(), personalAuthenticated: z.number() }),
    { unauthenticated: 60, personalAuthenticated: 5000 },
  ),
  task(
    "scalar_pg_connections",
    "https://www.postgresql.org/docs/current/runtime-config-connection.html",
    "Extract the default TCP listening port and the typical default max_connections setting for PostgreSQL.",
    z.object({ port: z.number(), maxConnections: z.number() }),
    { port: 5432, maxConnections: 100 },
  ),
  task(
    "scalar_iana_status",
    "https://www.iana.org/assignments/http-status-codes/http-status-codes.xhtml",
    "Copy the Description column verbatim for HTTP status 200, 418, and 429 from the IANA registry.",
    z.object({ status200: z.string(), status418: z.string(), status429: z.string() }),
    { status200: "OK", status418: "(Unused)", status429: "Too Many Requests" },
  ),
  task(
    "scalar_debian_releases",
    "https://www.debian.org/releases/",
    "From the Debian release table, extract the major version, codename and initial release date in YYYY-MM-DD for the row marked as the current stable release.",
    z.object({ majorVersion: z.number(), codename: z.string(), initialRelease: z.string() }),
    { majorVersion: 13, codename: "Trixie", initialRelease: "2025-08-09" },
  ),
  task(
    "scalar_mdn_safe_integer",
    "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/MAX_SAFE_INTEGER",
    "Extract the exact numeric value given under Value for Number.MAX_SAFE_INTEGER. Include a browser name only if the Value section explicitly names a specific browser.",
    z.object({ maximum: z.number(), browserName: z.string().optional() }),
    { maximum: 9007199254740991 },
  ),
];

export const locateRequiredTasks = [
  task(
    "required_rfc9000",
    "https://datatracker.ietf.org/doc/rfc9000/",
    "Extract the title of RFC 9000 without its RFC number, and its publication month and year as printed in the document information.",
    z.object({ title: z.string(), published: z.string() }),
    { title: "QUIC: A UDP-Based Multiplexed and Secure Transport", published: "May 2021" },
  ),
  task(
    "required_nginx_core",
    "https://nginx.org/en/docs/http/ngx_http_core_module.html",
    "Extract the default values of the NGINX client_header_timeout and client_max_body_size directives. Copy each amount with its unit and omit the directive name and semicolon.",
    z.object({ headerTimeout: z.string(), maxBodySize: z.string() }),
    { headerTimeout: "60s", maxBodySize: "1m" },
  ),
  task(
    "required_nist_prefixes",
    "https://www.nist.gov/pml/owm/metric-si-prefixes",
    "From the metric prefix table, copy the case-sensitive symbols for ronna and quecto.",
    z.object({ ronna: z.string(), quecto: z.string() }),
    { ronna: "R", quecto: "q" },
  ),
  task(
    "required_retry_after",
    "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Retry-After",
    "Extract the Retry-After example value that waits for a number of seconds, and the syntax placeholder for that seconds-based form, without angle brackets.",
    z.object({ exampleSeconds: z.number(), secondsPlaceholder: z.string() }),
    { exampleSeconds: 120, secondsPlaceholder: "delay-seconds" },
  ),
  task(
    "required_serde",
    "https://docs.rs/serde/latest/serde/",
    "Extract the Serde crate version shown in the page heading and the name of the Cargo feature that enables its derive macros. Copy just the version and feature name.",
    z.object({ version: z.string(), deriveFeature: z.string() }),
    { version: "1.0.229", deriveFeature: "derive" },
  ),
  task(
    "required_iana_tz",
    "https://www.iana.org/time-zones",
    "Extract the latest Time Zone Database version ID. Include its end-of-support date only if the latest version explicitly lists one. Do not infer a date from release notes.",
    z.object({ version: z.string(), endOfSupport: z.string().optional() }),
    { version: "2026f" },
  ),
  task(
    "required_python3130",
    "https://www.python.org/downloads/release/python-3130/",
    "Extract the Python version in the release heading. Include its Release date, verbatim, if that field is present. Ignore dates for superseding versions.",
    z.object({ version: z.string(), releaseDate: z.string().optional() }),
    { version: "3.13.0", releaseDate: "Oct. 7, 2024" },
  ),
];

export const liveTableCellTasks = [
  task(
    "live_cell_pg_numeric",
    "https://www.postgresql.org/docs/current/datatype-numeric.html",
    "From PostgreSQL's Numeric Types table, extract the storage sizes in bytes for smallint and bigint.",
    z.object({
      smallintBytes: z.number().describe("Storage Size in bytes for the smallint row"),
      bigintBytes: z.number().describe("Storage Size in bytes for the bigint row"),
    }),
    { smallintBytes: 2, bigintBytes: 8 },
  ),
  task(
    "live_cell_iana_charset",
    "https://www.iana.org/assignments/character-sets/character-sets.xhtml",
    "Extract the MIBenum numbers for the UTF-8 and US-ASCII entries in the Character Sets registry.",
    z.object({
      utf8Mib: z.number().describe("MIBenum column for the UTF-8 name"),
      asciiMib: z.number().describe("MIBenum column for the US-ASCII name"),
    }),
    { utf8Mib: 106, asciiMib: 3 },
  ),
  task(
    "live_cell_python_array",
    "https://docs.python.org/3/library/array.html",
    "Extract the minimum sizes in bytes for the unsigned long long and signed short types from the array type-code table.",
    z.object({
      longLongBytes: z.number().describe("Minimum size in bytes for unsigned long long"),
      shortBytes: z.number().describe("Minimum size in bytes for signed short"),
    }),
    { longLongBytes: 8, shortBytes: 2 },
  ),
  task(
    "live_cell_python_datetime",
    "https://docs.python.org/3/library/datetime.html",
    "Copy the Example cell for strftime directive %j verbatim and separately extract the numeric value of the module's MINYEAR constant.",
    z.object({
      example: z.string().describe("Example column for directive %j"),
      minimumYear: z
        .number()
        .describe("Earliest allowed year stated in prose for datetime MINYEAR constant"),
    }),
    { example: "001, 002, …, 366", minimumYear: 1 },
  ),
  task(
    "live_cell_etag",
    "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/ETag",
    "What numeric HTTP response status is sent when If-None-Match matches the current ETag?",
    z.object({
      status: z.number().describe("HTTP status code when If-None-Match matches the current ETag"),
    }),
    { status: 304 },
  ),
  task(
    "live_cell_css_units",
    "https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/length",
    "Copy the default viewport length unit defined as one percent of the smaller viewport dimension. Exclude viewport variants with an extra prefix.",
    z.object({ unit: z.string().describe("Default smaller-viewport-dimension length unit") }),
    { unit: "vmin" },
  ),
];
