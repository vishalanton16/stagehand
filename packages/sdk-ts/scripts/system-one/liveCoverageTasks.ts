import { z } from "zod/v4";
import type { CorpusTask } from "./corpus.js";

function exactList(name: string, url: string, instruction: string, expected: string[]): CorpusTask {
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

export const liveCoverageTasks: CorpusTask[] = [
  exactList(
    "promotion_sqlite_date_functions",
    "https://www.sqlite.org/lang_datefunc.html",
    "From the numbered list at the start of Overview, extract the seven SQLite date and time function names in order. Omit parentheses and arguments.",
    ["date", "time", "datetime", "julianday", "unixepoch", "strftime", "timediff"],
  ),
  exactList(
    "promotion_dockerfile_overview",
    "https://docs.docker.com/reference/dockerfile/",
    "Extract the exact Instruction column from the Overview table in order. Include every row.",
    [
      "ADD",
      "ARG",
      "CMD",
      "COPY",
      "ENTRYPOINT",
      "ENV",
      "EXPOSE",
      "FROM",
      "HEALTHCHECK",
      "LABEL",
      "MAINTAINER",
      "ONBUILD",
      "RUN",
      "SHELL",
      "STOPSIGNAL",
      "USER",
      "VOLUME",
      "WORKDIR",
    ],
  ),
  exactList(
    "promotion_neon_plans",
    "https://neon.com/pricing",
    "List the plan names in the Neon pricing plans section in page order. Exclude special programs and omit prices.",
    ["Free", "Launch", "Scale"],
  ),
  exactList(
    "promotion_public_runner_architectures",
    "https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job",
    "In the Standard GitHub-hosted runners for public repositories table, copy the Architecture column in page order. Keep duplicates and exclude the private repositories table.",
    ["x64", "x64", "x64", "arm64", "arm64", "Intel", "arm64"],
  ),
  exactList(
    "promotion_git_range_shorthands",
    "https://git-scm.com/docs/gitrevisions",
    "In the Other <rev>^ Parent Shorthand Notations section, list the three shorthand examples in the order explained. Copy the exact notation, including r1 or the placeholder as displayed and no surrounding prose.",
    ["r1^@", "r1^!", "<rev>^-[<n>]"],
  ),

  {
    name: "live_redis_general_data_types",
    url: "https://redis.io/docs/latest/develop/data-types/compare-data-types/",
    kind: "list",
    instruction:
      "List the names in the general-purpose data types bullet list, in order, excluding the earlier specialized types. Copy only the names before the explanations.",
    schema: z.object({ items: z.array(z.string()) }),
    grade: ({ items }) =>
      JSON.stringify(items) ===
      JSON.stringify([
        "Strings",
        "Arrays",
        "Hashes",
        "JSON",
        "Lists",
        "Sets",
        "Sorted sets",
        "Streams",
      ])
        ? undefined
        : "wrong general-purpose data types",
  },
  {
    name: "live_python_combinatoric_iterators",
    url: "https://docs.python.org/3.12/library/itertools.html",
    kind: "list",
    instruction:
      "Return every iterator name in the Combinatoric iterators summary table, in table order, including its empty parentheses. Exclude the other summary tables.",
    schema: z.object({ items: z.array(z.string()) }),
    grade: ({ items }) =>
      JSON.stringify(items) ===
      JSON.stringify([
        "product()",
        "permutations()",
        "combinations()",
        "combinations_with_replacement()",
      ])
        ? undefined
        : "wrong combinatoric iterators",
  },
  {
    name: "live_iana_media",
    url: "https://www.iana.org/assignments/top-level-media-types/top-level-media-types.xhtml",
    kind: "list",
    instruction:
      "List the name of every Top-Level Media Type in the registry table in page order. Copy just the Name column.",
    schema: z.object({ items: z.array(z.string()) }),
    grade: ({ items }) =>
      JSON.stringify(items) ===
      JSON.stringify([
        "application",
        "audio",
        "example",
        "font",
        "haptics",
        "image",
        "message",
        "model",
        "multipart",
        "text",
        "video",
      ])
        ? undefined
        : "wrong media types",
  },
  {
    name: "live_kubernetes_services",
    url: "https://kubernetes.io/docs/concepts/services-networking/service/",
    kind: "list",
    instruction:
      "List exactly the four Service type names enumerated in the Service type section, in the order shown. Copy only the names.",
    schema: z.object({ items: z.array(z.string()) }),
    grade: ({ items }) =>
      JSON.stringify(items) ===
      JSON.stringify(["ClusterIP", "NodePort", "LoadBalancer", "ExternalName"])
        ? undefined
        : "wrong service types",
  },
  {
    name: "live_w3c_landmarks",
    url: "https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA11",
    kind: "list",
    instruction:
      "List every landmark role in the Description section's list of role values, in page order. Return the role names only.",
    schema: z.object({ items: z.array(z.string()) }),
    grade: ({ items }) =>
      JSON.stringify(items) ===
      JSON.stringify([
        "banner",
        "navigation",
        "main",
        "region",
        "form",
        "search",
        "complementary",
        "contentinfo",
      ])
        ? undefined
        : "wrong landmark roles",
  },
  {
    name: "live_docker_container_filters",
    url: "https://docs.docker.com/reference/cli/docker/container/ls/",
    kind: "list",
    instruction:
      "Copy the exact Filter column from the table under Filtering (--filter), in table order, as one string per row.",
    schema: z.object({ items: z.array(z.string()) }),
    grade: ({ items }) =>
      JSON.stringify(items) ===
      JSON.stringify([
        "id",
        "name",
        "label",
        "exited",
        "status",
        "ancestor",
        "before or since",
        "volume",
        "network",
        "publish or expose",
        "health",
        "isolation",
        "is-task",
      ])
        ? undefined
        : "wrong container filters",
  },
  {
    name: "live_mdn_promise_methods",
    url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise",
    kind: "list",
    instruction:
      "List the Promise static method names in the Static methods section, in page order. Use the form Promise.method(). Exclude instance methods.",
    schema: z.object({ items: z.array(z.string()) }),
    grade: ({ items }) =>
      JSON.stringify(
        Array.isArray(items)
          ? items.map((item) =>
              typeof item === "string" ? item.replace(/\s+Experimental$/u, "") : item,
            )
          : items,
      ) ===
      JSON.stringify([
        "Promise.all()",
        "Promise.allKeyed()",
        "Promise.allSettled()",
        "Promise.allSettledKeyed()",
        "Promise.any()",
        "Promise.race()",
        "Promise.reject()",
        "Promise.resolve()",
        "Promise.try()",
        "Promise.withResolvers()",
      ])
        ? undefined
        : "wrong static methods",
  },
];
