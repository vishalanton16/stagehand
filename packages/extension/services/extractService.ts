import { mapCopyExtract } from "./decisions/mapCopy.js";
import { readDomCodeText } from "./decisions/domCodeText.js";
import { scalarReader } from "./decisions/scalarReader.js";
import { extractWithClairic } from "./decisions/clairic.js";
import { extractWithDecider } from "./decisions/decider.js";
import { TimeoutError } from "../errors.js";
import { extractionCompleted } from "./decisions/extractCheck.js";
import { runDecisionsExtract, type JsonSchema } from "./decisions/extract.js";
import type { DecisionsConfig } from "./decisions/pipeline.js";
import { parseOutline } from "./decisions/tree.js";
import { z } from "zod/v4";
import type {
  ClientModelReference,
  ExtractResult,
  LLMImageContent,
  ModelConfig,
  StagehandExtractParams,
} from "@browserbasehq/stagehand-protocol/types";
import * as inference from "../inference.js";
import type { ClientLlmRequest } from "../llm/clientLlmClient.js";
import type { GatewayContext } from "../llm/gatewayClient.js";
import type { StagehandLogger } from "../logger.js";
import type { UnderstudyRuntimePage } from "../runtime.js";
import { bytesToBase64 } from "../understudy/fileUploadUtils.js";
import type { Page } from "../understudy/page.js";
import { type Progress, runWithProgress } from "../understudy/progress.js";
import type { EncodedId, ZodPathSegments } from "../types/private/internal.js";
import { injectUrls, transformSchema } from "../utils.js";
import * as cacheService from "./cacheService.js";
import * as llmService from "./llmService.js";
import { disabledCacheMetadata, zeroStagehandResultUsage } from "./resultUsage.js";

/** Replaces URL strings with numeric DOM IDs until extraction has resolved the page's URL map. */
export function transformUrlStringsToNumericIds<Schema extends z.ZodType>(
  schema: Schema,
): [z.ZodType, ZodPathSegments[]] {
  const [finalSchema, urlPaths] = transformSchema(schema, []);
  return [finalSchema, urlPaths];
}

interface ExtractionResponseBase {
  metadata: { completed: boolean };
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
  cached_input_tokens: number;
  inference_time_ms: number;
}

type ExtractionResponse<Schema extends z.ZodObject> = ExtractionResponseBase & z.infer<Schema>;

type ExtractServiceOptions = {
  params: StagehandExtractParams;
  page: Pick<Page, "captureSnapshot" | "screenshot"> &
    Partial<Pick<UnderstudyRuntimePage, "evaluate">>;
  model: ModelConfig | ClientModelReference | undefined;
  clientLLMGenerate: ClientLlmRequest;
  logger: StagehandLogger;
  systemPrompt?: string;
  cache?: cacheService.CacheContext;
  gateway?: GatewayContext;
  decisions?: DecisionsConfig;
  progress?: Progress;
  speculateListMapping?: boolean;
  /** Internal replay control. SDK calls use the default group selection. */
  groupExperiment?: Parameters<typeof mapCopyExtract>[1]["groupExperiment"];
  /** Internal live benchmark control for rendered code-cell evidence. */
  domCodeTextExperiment?: boolean;
};

export async function extract(options: ExtractServiceOptions): Promise<ExtractResult> {
  return runWithProgress(
    options.progress ?? { name: "extract()", timeout: options.params.options?.timeout ?? 0 },
    (progress) => extractWithProgress(options, progress),
  );
}

async function extractWithProgress(
  {
    params,
    page,
    model,
    clientLLMGenerate,
    logger,
    systemPrompt = "",
    cache,
    gateway,
    decisions,
    speculateListMapping,
    groupExperiment,
    domCodeTextExperiment,
  }: ExtractServiceOptions,
  progress: Progress,
): Promise<ExtractResult> {
  const { instruction, options } = params;
  if (decisions) {
    const recordDecisionUsage = decisions.recordDecisionUsage;
    decisions = {
      ...decisions,
      signal: progress.signal,
      recordDecisionUsage: (usage) => {
        recordDecisionUsage?.(usage);
        logger.info("Decision model usage", {
          category: "decisions-usage",
          ...usage,
        });
      },
    };
  }

  // Cache keys contain DOM state, not screenshot pixels. Do not serve a
  // visual extraction from a cache entry that cannot represent its image.
  if (options?.screenshot) {
    return (await runExtraction()).result;
  }

  return await cacheService.withCache<ExtractResult>({
    method: "extract",
    page,
    data: cacheService.buildExtractCacheData(params),
    caching: options?.cache,
    bypass: cacheService.shouldBypassCacheForLocatorScope(options),
    context: cache,
    logger,
    progress,
    onHit: (value) => ({
      data: z.json().parse(value),
      metadata: { usage: zeroStagehandResultUsage(), cache: disabledCacheMetadata() },
    }),
    execute: () => runExtraction(),
  });

  async function runExtraction(): Promise<cacheService.CacheExecuteOutcome<ExtractResult>> {
    progress.throwIfStopped();
    const snapshot = await page.captureSnapshot(
      {
        focusLocator: options?.locator,
        ignoreLocators: options?.ignoreLocators,
      },
      progress,
    );
    progress.throwIfStopped();

    const { combinedTree, combinedUrlMap } = snapshot;
    let nativeUsage = zeroStagehandResultUsage();
    if (decisions?.extract === "native" && instruction) {
      try {
        const common = {
          params,
          systemPrompt,
          progress,
          page: { captureSnapshot: async () => snapshot, screenshot: page.screenshot.bind(page) },
          recordUsage: (usage: typeof nativeUsage) => {
            nativeUsage = usage;
            logger.info("Decision model usage", {
              category: "decisions-usage",
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
            });
          },
        };
        const result =
          decisions.provider === "cloudflare" && decisions.accountId
            ? await extractWithClairic({
                ...common,
                model: { apiKey: decisions.apiKey, accountId: decisions.accountId },
              })
            : decisions.provider === "perplexity"
              ? await extractWithDecider({
                  ...common,
                  model: {
                    apiKey: decisions.apiKey,
                    modelName: decisions.model ?? "pplx-decider-latest",
                  },
                })
              : undefined;
        if (result) return { result, cacheValue: result.data };
        throw new Error("Native extraction requires Cloudflare Clairic or Perplexity Decider");
      } catch (error) {
        progress.throwIfStopped();
        if (decisions.llmFallback === false) throw error;
        logger.info("Native extraction fell back to the LLM", { category: "decisions" });
      }
    }
    const screenshot = options?.screenshot
      ? await page.screenshot({ fullPage: false, type: "png" }, progress)
      : undefined;
    progress.throwIfStopped();

    logger.info(
      screenshot
        ? "Starting extraction using an accessibility snapshot and viewport screenshot"
        : "Starting extraction using an accessibility snapshot",
      {
        category: "extraction",
        instruction,
      },
    );

    const schema = z.fromJSONSchema(params.schema as Parameters<typeof z.fromJSONSchema>[0]);
    let extractionTree = combinedTree;

    if (decisions?.extract === "map" && instruction && !screenshot) {
      const evaluate = page.evaluate?.bind(page);
      if (
        domCodeTextExperiment &&
        evaluate &&
        !options?.locator &&
        !options?.ignoreLocators?.length
      ) {
        const started = performance.now();
        try {
          const evidence = await progress.run("reading rendered code cells", () =>
            readDomCodeText({ evaluate }, combinedTree, snapshot.combinedXpathMap),
          );
          extractionTree = evidence.tree;
          logger.debug("Rendered code-cell evidence", {
            category: "decisions",
            inspected: evidence.inspected,
            corrected: evidence.corrected,
            durationMs: Math.round(performance.now() - started),
          });
        } catch {
          progress.throwIfStopped();
          logger.debug("Rendered code-cell evidence unavailable", { category: "decisions" });
        }
      }
      const started = performance.now();
      let decisionRequests = 0;
      const trace: Parameters<typeof mapCopyExtract>[1]["trace"] = [];
      const config = {
        ...decisions,
        recordDecisionUsage: (usage: { inputTokens: number; outputTokens: number }) => {
          decisionRequests++;
          nativeUsage.inputTokens += usage.inputTokens;
          nativeUsage.outputTokens += usage.outputTokens;
          decisions?.recordDecisionUsage?.(usage);
        },
      };
      let reason = "unresolved";
      try {
        const outcome = await progress.run("mapping extraction evidence", () =>
          mapCopyExtract(config, {
            instruction,
            schema: params.schema as Parameters<typeof mapCopyExtract>[1]["schema"],
            tree: extractionTree,
            urlMap: (combinedUrlMap ?? {}) as Record<string, string>,
            reader: scalarReader(config, progress),
            readerChecks: true,
            verify: true,
            askVerifier: false,
            speculateListMapping,
            groupExperiment,
            trace,
          }),
        );
        progress.throwIfStopped();
        const valid = schema.safeParse(outcome.data);
        const problems = outcome.verdict?.problems ?? ["missing_verdict"];
        nativeUsage.inferenceTimeMs = Math.round(performance.now() - started);
        if (valid.success && problems.length === 0) {
          logger.info("System One extraction accepted", {
            category: "decisions",
            decisionRequests,
          });
          logger.debug("System One extraction trace", {
            category: "decisions",
            trace: JSON.stringify(trace),
          });
          return {
            result: {
              data: z.json().parse(valid.data),
              metadata: { usage: nativeUsage, cache: disabledCacheMetadata() },
            },
            cacheValue: valid.data,
          };
        }
        reason = valid.success ? problems.join(",") : "schema_mismatch";
      } catch (error) {
        progress.throwIfStopped();
        reason = error instanceof Error ? error.message : String(error);
      }
      nativeUsage.inferenceTimeMs = Math.round(performance.now() - started);
      logger.info("System One extraction fell back to the LLM", {
        category: "decisions",
        reason,
        decisionRequests,
      });
      logger.debug("System One extraction trace", {
        category: "decisions",
        trace: JSON.stringify(trace),
      });
      if (decisions.llmFallback === false)
        throw new Error(`System One extraction abstained (${reason})`);
    }

    // Pick-and-copy: the decision model chooses the elements that hold the values, code copies
    // their text. Screenshot-based extraction stays with the LLM.
    if (decisions?.extract === "pick" && instruction && !screenshot) {
      const outcome = await runDecisionsExtract(decisions, {
        logger,
        instruction,
        schema: params.schema as JsonSchema,
        snap: { tree: combinedTree, xpathMap: {}, nodes: parseOutline(combinedTree) },
        urlMap: (combinedUrlMap ?? {}) as Record<string, string>,
        ensureTimeRemaining: () => progress.throwIfStopped(),
        gate: decisions.llmFallback !== false,
      }).catch((error: unknown) => {
        if (error instanceof TimeoutError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        return { kind: "fallback" as const, reason: `decision_error:${message}` };
      });
      const valid = outcome.kind === "done" ? schema.safeParse(outcome.data) : undefined;
      if (outcome.kind === "done" && valid?.success) {
        return {
          result: {
            data: z.json().parse(valid.data),
            metadata: { usage: zeroStagehandResultUsage(), cache: disabledCacheMetadata() },
          },
          cacheValue: valid.data,
          llmUsage: { inputTokens: 0, outputTokens: 0, llmDurationMs: 0 },
        };
      }
      const reason = outcome.kind === "fallback" ? outcome.reason : "schema_mismatch";
      logger.info("Decisions extract fell back to the LLM", {
        category: "decisions",
        instruction,
        reason,
      });
      if (decisions.llmFallback === false) {
        throw new Error(`Decisions extract abstained (${reason})`);
      }
    }
    const isObjectSchema = schema instanceof z.ZodObject;
    const wrapKey = "value" as const;
    const objectSchema: z.ZodObject = isObjectSchema
      ? schema
      : z.object({
          [wrapKey]: schema,
        });
    const [transformedSchema, urlFieldPaths] = transformUrlStringsToNumericIds(objectSchema);

    const screenshotContent: LLMImageContent | undefined = screenshot
      ? {
          type: "image",
          data: bytesToBase64(screenshot),
          mimeType: "image/png",
        }
      : undefined;

    progress.throwIfStopped();
    const extractionResponse: ExtractionResponse<z.ZodObject> =
      await inference.extract<z.ZodObject>({
        instruction,
        domElements: extractionTree,
        schema: transformedSchema as z.ZodObject,
        generate: (input) =>
          progress.run("waiting for extract inference", () =>
            llmService.generate(model, input, clientLLMGenerate, gateway),
          ),
        userProvidedInstructions:
          decisions?.extract === "map"
            ? [
                systemPrompt,
                "For optional fields, omit the field when the supplied page does not contain the requested fact. Absence is not zero. Return zero only when the page explicitly reports zero for that fact. Do not infer values from outside knowledge.",
              ]
                .filter(Boolean)
                .join("\n")
            : systemPrompt,
        screenshot: screenshotContent,
        ...(decisions &&
        decisions.extract !== "native" &&
        decisions.extract !== "map" &&
        instruction
          ? {
              judgeCompleted: async (extracted: unknown) => {
                const trace: Record<string, unknown>[] = [];
                const verdict = await extractionCompleted(
                  {
                    config: decisions,
                    instruction,
                    trace: trace as never,
                    threshold: 0.5,
                    logger,
                    ensureTimeRemaining: () => progress.throwIfStopped(),
                  },
                  extracted,
                );
                logger.info("Decisions extract completion", {
                  category: "decisions",
                  instruction,
                  score: verdict.score,
                  trace: JSON.stringify(trace),
                });
                return verdict.completed;
              },
            }
          : {}),
      });
    progress.throwIfStopped();

    const {
      metadata: { completed },
      prompt_tokens,
      completion_tokens,
      reasoning_tokens,
      cached_input_tokens,
      inference_time_ms,
      ...rest
    } = extractionResponse;
    let output = rest as z.infer<z.ZodObject>;

    const idToUrl: Record<EncodedId, string> = (combinedUrlMap ?? {}) as Record<EncodedId, string>;
    for (const { segments } of urlFieldPaths) {
      injectUrls(
        output as Record<string, unknown>,
        segments,
        idToUrl as unknown as Record<string, string>,
      );
    }
    if (!isObjectSchema && output && typeof output === "object") {
      output = (output as Record<string, unknown>)[wrapKey] as z.infer<z.ZodObject>;
    }

    logger.info(
      completed
        ? "Extraction completed successfully"
        : "Extraction incomplete after processing all data",
      {
        category: "extraction",
        promptTokens: prompt_tokens,
        completionTokens: completion_tokens,
        inferenceTimeMs: inference_time_ms,
      },
    );

    return {
      result: {
        data: z.json().parse(output),
        metadata: {
          usage: {
            inputTokens: prompt_tokens + nativeUsage.inputTokens,
            outputTokens: completion_tokens + nativeUsage.outputTokens,
            reasoningTokens: reasoning_tokens,
            cachedInputTokens: cached_input_tokens,
            inferenceTimeMs: inference_time_ms + nativeUsage.inferenceTimeMs,
          },
          cache: disabledCacheMetadata(),
        },
      },
      cacheValue: output,
      llmUsage: {
        inputTokens: prompt_tokens,
        outputTokens: completion_tokens,
        llmDurationMs: inference_time_ms,
      },
    };
  }
}
