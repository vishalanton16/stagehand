import { z } from "zod/v4";
import type { Progress } from "../../understudy/progress.js";
import type { DecisionsConfig } from "./pipeline.js";
import type { ScalarReader } from "./mapCopy.js";
import { providerFor } from "./providers.js";
import { extractWithDecider } from "./decider.js";

/** Reads source text so map-and-copy can check it against the supplied evidence. */
export function scalarReader(
  config: DecisionsConfig,
  progress: Progress,
): ScalarReader | undefined {
  if (config.provider !== "perplexity") return undefined;
  return async ({ sheet, fields }) => {
    const schema = z.object(
      Object.fromEntries(
        fields.map((field) => [field.name, z.string().describe(field.instructions).optional()]),
      ),
    );
    const result = await extractWithDecider({
      params: {
        pageId: "decision-evidence",
        instruction: "Copy the requested values from the supplied evidence. Omit absent values.",
        schema: z.json().parse(z.toJSONSchema(schema)),
      },
      page: {
        captureSnapshot: async () => ({
          combinedTree: sheet,
          combinedXpathMap: {},
          combinedUrlMap: {},
        }),
      },
      model: {
        apiKey: config.apiKey,
        modelName: config.model ?? "pplx-decider-latest",
        apiUrl: config.apiUrl,
        timeoutMs: providerFor(config).defaultTimeoutMs,
      },
      systemPrompt: "",
      progress,
      recordUsage: (usage) => config.recordDecisionUsage?.(usage),
    });
    return result.data as Record<string, string | undefined>;
  };
}
