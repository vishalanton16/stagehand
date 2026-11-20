import OpenAI from "openai";
import type { LLMGenerateParams, LLMGenerateResult } from "@browserbasehq/stagehand-protocol/types";
import { z } from "zod/v4";
import { msSince } from "./pages.ts";

export const lunaModel = "openai/gpt-6-luna";
export const lunaTimeout = 30_000;

export type LunaCall = {
  schema: string;
  offsetMs: number;
  ms?: number;
  model?: string;
  usage?: LLMGenerateResult["usage"];
  error?: { name: string; httpStatus?: number };
};

export function makeLuna() {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) throw new Error("AI_GATEWAY_API_KEY is required");
  return new OpenAI({
    apiKey,
    baseURL: process.env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1",
    maxRetries: 0,
    timeout: lunaTimeout,
  });
}

// Forward the SDK's operation-specific instructions, messages and schema to Responses.
export async function generateLuna(
  client: OpenAI,
  params: LLMGenerateParams,
  calls: LunaCall[],
  trialStart: number,
): Promise<LLMGenerateResult> {
  const format = params.responseFormat;
  if (
    format?.type !== "json_schema" ||
    !format.schema ||
    typeof format.schema !== "object" ||
    Array.isArray(format.schema)
  )
    throw new Error("Expected an object JSON Schema from the SDK");
  const started = performance.now();
  const call: LunaCall = { schema: format.name, offsetMs: msSince(trialStart) };
  calls.push(call);
  try {
    const response = await client.responses.create({
      model: lunaModel,
      instructions: params.systemPrompt,
      input: params.messages.map(({ role, content }) => ({
        role,
        content: (Array.isArray(content) ? content : [content])
          .map((block) => {
            if (block.type !== "text") throw new Error("Expected text from the SDK");
            return block.text;
          })
          .join("\n"),
      })),
      temperature: params.temperature,
      text: {
        format: {
          type: "json_schema",
          name: format.name,
          description: format.description,
          schema: format.schema,
          strict: true,
        },
      },
    });

    call.model = response.model;
    if (response.usage)
      call.usage = {
        inputTokens: response.usage.input_tokens,
        cachedInputTokens: response.usage.input_tokens_details?.cached_tokens ?? 0,
        outputTokens: response.usage.output_tokens,
        reasoningTokens: response.usage.output_tokens_details?.reasoning_tokens ?? 0,
        totalTokens: response.usage.total_tokens,
      };
    if (!response.output_text) throw new Error("Responses returned no output text");
    return {
      role: "assistant",
      content: { type: "text", text: response.output_text },
      outputFormat: "json_schema",
      structuredContent: z.json().parse(JSON.parse(response.output_text)),
      stopReason: response.status,
      usage: call.usage,
    };
  } catch (error) {
    call.error = {
      name: error instanceof Error ? error.name : "Error",
      ...(error instanceof OpenAI.APIError ? { httpStatus: error.status } : {}),
    };
    throw error;
  } finally {
    call.ms = msSince(started);
  }
}
