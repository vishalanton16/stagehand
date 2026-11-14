import { z } from "zod/v4";
import type { CorpusTask } from "./corpus.js";

function orderedList(
  name: string,
  url: string,
  instruction: string,
  expected: string[],
): CorpusTask {
  return {
    name,
    url,
    instruction,
    kind: "list",
    schema: z.object({ items: z.array(z.string()) }),
    grade: ({ items }) =>
      JSON.stringify(items) === JSON.stringify(expected) ? undefined : "wrong items or order",
  };
}

export const heldout7Tasks = [
  orderedList(
    "hold7_sqlite_storage_classes",
    "https://www.sqlite.org/datatype3.html",
    "List the five storage class names from section 2. Use the uppercase names only, in page order. Exclude the later type affinities.",
    ["NULL", "INTEGER", "REAL", "TEXT", "BLOB"],
  ),
  orderedList(
    "hold7_kubernetes_pod_phases",
    "https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/",
    "List every phase name in the Pod phase table in table order. Exclude the conditions and container states.",
    ["Pending", "Running", "Succeeded", "Failed", "Unknown"],
  ),
  orderedList(
    "hold7_postgres_range_names",
    "https://www.postgresql.org/docs/current/rangetypes.html",
    "List the built-in range type names in section 8.17.1, in page order, excluding their corresponding multirange types.",
    ["int4range", "int8range", "numrange", "tsrange", "tstzrange", "daterange"],
  ),
  orderedList(
    "hold7_wasm_number_types",
    "https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/Understanding_the_text_format",
    "List the value type identifiers under Number types, in page order. Exclude vector and reference types.",
    ["i32", "i64", "f32", "f64"],
  ),
  orderedList(
    "hold7_github_repo_qualifiers",
    "https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests",
    "List the exact Qualifier cells from the table under Search within a user's or organization's repositories, in table order. Do not include the examples.",
    ["user:USERNAME", "org:ORGNAME", "repo:USERNAME/REPOSITORY"],
  ),
];
