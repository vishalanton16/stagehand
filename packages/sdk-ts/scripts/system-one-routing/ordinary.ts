import { trace } from "@opentelemetry/api";
import OpenAI from "openai";
import type { LLMGenerateResult } from "@browserbasehq/stagehand-protocol/types";
import type { DecisionModelConfig } from "../../../extension/services/decisions/client.js";
import type { ObservationSnapshot } from "../../../extension/services/decisions/observeCandidates.js";
import type { ObservationOutcome } from "../../../extension/services/decisions/observeSelection.js";
import { StagehandLogger } from "../../../extension/logger.js";
import { observe } from "../../../extension/services/observeService.js";
import { GATEWAY_ROOT } from "./gateway.js";

export const ORDINARY_MODEL = "openai/gpt-6-luna";
const logger = new StagehandLogger({ tracer: trace.getTracer("system-one-replay") }, () => {});

export async function selectOrdinaryObservation(
  config: DecisionModelConfig,
  snapshot: ObservationSnapshot,
  instruction?: string,
): Promise<ObservationOutcome> {
  const openai = new OpenAI({
    apiKey: config.apiKey,
    baseURL: `${GATEWAY_ROOT}/v1`,
    maxRetries: 0,
  });
  const result = await observe({
    logger,
    params: { pageId: "frozen", instruction, options: { cache: false, timeout: 20_000 } },
    page: {
      captureSnapshot: async () => ({
        combinedTree: snapshot.formattedTree,
        combinedXpathMap: snapshot.xpathMap,
        combinedUrlMap: snapshot.urlMap,
        combinedEditableIds: snapshot.editableIds,
      }),
    },
    model: { source: "client" },
    async clientLLMGenerate(params): Promise<LLMGenerateResult> {
      const format = params.responseFormat;
      if (
        format?.type !== "json_schema" ||
        !format.schema ||
        typeof format.schema !== "object" ||
        Array.isArray(format.schema)
      ) {
        throw new Error("Ordinary Observe requires an object schema");
      }
      const response = await openai.responses.create(
        {
          model: ORDINARY_MODEL,
          reasoning: { effort: "none" },
          instructions: params.systemPrompt,
          input: params.messages.map(({ role, content }) => ({
            role,
            content: (Array.isArray(content) ? content : [content])
              .map((block) => {
                if (block.type !== "text") throw new Error("Observe replay accepts text evidence");
                return block.text;
              })
              .join("\n"),
          })),
          text: {
            format: { type: "json_schema", name: format.name, schema: format.schema, strict: true },
          },
        },
        { signal: config.signal },
      );
      if (!response.output_text) throw new Error("Ordinary Observe returned no structured output");
      if (response.usage)
        config.recordDecisionUsage?.({
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          model: response.model,
        });
      return {
        role: "assistant",
        content: { type: "text", text: response.output_text },
        outputFormat: "json_schema",
        structuredContent: JSON.parse(response.output_text),
      };
    },
  });
  return { kind: "done", actions: result.data };
}
