import { z } from "zod/v4";
import type { CorpusTask } from "./corpus.js";

// Tasks and schemas were defined before capture. Graders were set before replay.
// Excluded captures: Wikibooks returned a missing-page notice, MTU returned an
// error page, and the Sonic Pi snapshot did not explicitly credit a sole creator.
export const heldout6Tasks: CorpusTask[] = [
  {
    name: "hold6_nasa_mars",
    url: "https://science.nasa.gov/mars/facts/",
    kind: "scalar",
    instruction:
      "Extract the duration of one Martian day in hours and one Martian year in Earth days, as stated on this page.",
    schema: z.object({ dayHours: z.number(), yearEarthDays: z.number() }),
    grade: ({ dayHours, yearEarthDays }) =>
      dayHours === 24.6 && yearEarthDays === 687 ? undefined : "wrong Mars day or year",
  },

  {
    name: "hold6_curl_protocols",
    url: "https://curl.se/docs/manpage.html",
    kind: "list",
    instruction:
      "List every protocol label in the PROTOCOLS section, in the order they are listed. Exclude the protocol names mentioned elsewhere.",
    schema: z.object({ protocols: z.array(z.string()) }),
    grade: (data) =>
      JSON.stringify(data.protocols) ===
      JSON.stringify([
        "DICT",
        "FILE",
        "FTP(S)",
        "GOPHER(S)",
        "HTTP(S)",
        "IMAP(S)",
        "LDAP(S)",
        "MQTT",
        "POP3(S)",
        "RTSP",
        "SCP",
        "SFTP",
        "SMTP(S)",
        "TELNET",
        "TFTP",
        "WS(S)",
      ])
        ? undefined
        : "wrong protocol labels or order",
  },
  {
    name: "hold6_rust_types",
    url: "https://doc.rust-lang.org/book/ch03-02-data-types.html",
    kind: "list",
    instruction:
      "In Table 3-1, extract every row in order with its Length, Signed, and Unsigned columns. Preserve the text of each cell.",
    schema: z.object({
      rows: z.array(z.object({ length: z.string(), signed: z.string(), unsigned: z.string() })),
    }),
    grade: (data) =>
      JSON.stringify(
        data.rows?.map(
          ({ length, signed, unsigned }: { length: string; signed: string; unsigned: string }) => [
            length,
            signed,
            unsigned,
          ],
        ),
      ) ===
      JSON.stringify([
        ["8-bit", "i8", "u8"],
        ["16-bit", "i16", "u16"],
        ["32-bit", "i32", "u32"],
        ["64-bit", "i64", "u64"],
        ["128-bit", "i128", "u128"],
        ["Architecture-dependent", "isize", "usize"],
      ])
        ? undefined
        : "wrong integer type rows",
  },

  {
    name: "hold6_economics_school",
    url: "https://www.core-econ.org/the-economy/",
    kind: "scalar",
    instruction:
      "What is the title of the introductory textbook described on this page? Include the current edition number only if the page explicitly identifies it as an edition.",
    schema: z.object({ title: z.string(), edition: z.number().optional() }),
    grade: ({ title, edition }) =>
      /^the economy 2\.0$/i.test(title ?? "") && edition === undefined
        ? undefined
        : "wrong title or inferred edition",
  },
];

// Separate confirmation task defined after the changes and before capture.
// GNU Make was excluded after navigation timed out.
export const confirmationTasks: CorpusTask[] = [
  {
    name: "confirm_nginx_signals",
    url: "https://nginx.org/en/docs/control.html",
    kind: "list",
    instruction:
      "List the signal names in the first table about controlling the master process, in order. Exclude the signals in the later worker process table.",
    schema: z.object({ signals: z.array(z.string()) }),
    grade: ({ signals }) => {
      if (!Array.isArray(signals) || signals.some((signal) => typeof signal !== "string"))
        return "missing signal names";
      const names = signals.flatMap((cell: string) => cell.split(/,\s*/));
      return JSON.stringify(names) ===
        JSON.stringify(["TERM", "INT", "QUIT", "HUP", "USR1", "USR2", "WINCH"])
        ? undefined
        : "incorrect master process signal list";
    },
  },
];
