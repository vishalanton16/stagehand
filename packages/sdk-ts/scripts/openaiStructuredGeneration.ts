import type OpenAI from "openai";
import type { ResponseInput } from "openai/resources/responses/responses";
import { z } from "zod/v4";
import type {
  LLMGenerateParams,
  LLMGenerateResult,
  LLMMessageContentBlock,
} from "@browserbasehq/stagehand-protocol/types";

export async function generateWithOpenAI(
  openai: OpenAI,
  model: string,
  params: LLMGenerateParams,
  recordUsage?: (usage: NonNullable<LLMGenerateResult["usage"]>) => void,
): Promise<LLMGenerateResult> {
  if (params.responseFormat?.type !== "json_schema") {
    throw new TypeError(
      "This example supports the structured generation used by act, extract, and observe",
    );
  }

  const schema = params.responseFormat.schema;
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    throw new TypeError("OpenAI structured output requires an object JSON Schema");
  }

  const input: ResponseInput = params.messages.map((message) => ({
    role: message.role,
    content: messageText(message.content),
  }));
  const response = await openai.responses.create({
    model,
    instructions: params.systemPrompt,
    input,
    temperature: params.temperature,
    text: {
      format: {
        type: "json_schema",
        name: params.responseFormat.name,
        description: params.responseFormat.description,
        schema,
        strict: true,
      },
    },
  });

  const usage = response.usage && {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    totalTokens: response.usage.total_tokens,
    reasoningTokens: response.usage.output_tokens_details?.reasoning_tokens ?? 0,
    cachedInputTokens: response.usage.input_tokens_details?.cached_tokens ?? 0,
  };
  if (usage) recordUsage?.(usage);
  if (!response.output_text) throw new Error("OpenAI returned no output text");

  return {
    role: "assistant",
    content: { type: "text", text: response.output_text },
    outputFormat: "json_schema",
    structuredContent: z.json().parse(JSON.parse(response.output_text)),
    ...(response.status ? { stopReason: response.status } : {}),
    ...(usage ? { usage } : {}),
  };
}

function messageText(content: LLMMessageContentBlock | LLMMessageContentBlock[]): string {
  const blocks = Array.isArray(content) ? content : [content];
  return blocks
    .map((block) => {
      if (block.type !== "text") {
        throw new TypeError(`This example does not support ${block.type} message blocks`);
      }
      return block.text;
    })
    .join("\n");
}
