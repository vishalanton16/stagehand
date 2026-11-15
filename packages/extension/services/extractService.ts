import { mapCopyExtract } from "./decisions/mapCopy.js";
import { scalarReader } from "./decisions/scalarReader.js";
import { extractTableScalar, prepareTableScalar } from "./decisions/tableScalar.js";
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
import { compactExtractionTree } from "./compactExtractionTree.js";
import * as llmService from "./llmService.js";
import { disabledCacheMetadata, zeroStagehandResultUsage } from "./resultUsage.js";

/** Replaces URL strings with numeric DOM IDs until extraction has resolved the page's URL map. */
export function transformUrlStringsToNumericIds<Schema extends z.ZodType>(
  schema: Schema,
): [z.ZodType, ZodPathSegments[]] {
  const [finalSchema, urlPaths] = transformSchema(schema, []);
  return [finalSchema, urlPaths];
}

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
  /** Internal live benchmark control for table cell selection. */
  tableCellExperiment?: boolean;
  /** Internal benchmark control for the text sent to the LLM. */
  compactEvidenceExperiment?: boolean;
};

function isRequiredFlatScalarSchema(
  schema: Parameters<typeof mapCopyExtract>[1]["schema"],
): boolean {
  if (schema.type !== "object") return false;
  const fields = Object.entries(schema.properties ?? {});
  const required = new Set(schema.required);
  return (
    fields.length > 0 &&
    fields.length <= 8 &&
    fields.every(
      ([name, field]) =>
        required.has(name) &&
        !field.format &&
        !field.anyOf &&
        (field.type === "string" || field.type === "number" || field.type === "integer"),
    )
  );
}

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
    tableCellExperiment,
    compactEvidenceExperiment,
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
    let triedTableReader = false;
    const jsonSchema = params.schema as Parameters<typeof mapCopyExtract>[1]["schema"];
    const evaluateTable = tableCellExperiment ? page.evaluate?.bind(page) : undefined;
    if (
      evaluateTable &&
      decisions?.provider === "perplexity" &&
      decisions.extract === "map" &&
      instruction &&
      !screenshot &&
      !options?.locator &&
      !options?.ignoreLocators?.length &&
      isRequiredFlatScalarSchema(jsonSchema)
    ) {
      const browserStarted = performance.now();
      let candidates;
      try {
        if (/\] (?:table|grid)(?=:|\n|$)/i.test(combinedTree)) {
          candidates = await progress.run("reading table cell candidates", () =>
            prepareTableScalar({ evaluate: evaluateTable }, jsonSchema, instruction),
          );
        }
      } catch {
        progress.throwIfStopped();
      }
      logger.debug("Table cell routing", {
        category: "decisions",
        eligible: !!candidates,
        browserMs: Math.round(performance.now() - browserStarted),
        candidateCounts: candidates?.map(({ cells }) => cells.length) ?? [],
      });
      if (candidates) {
        triedTableReader = true;
        const started = performance.now();
        const trace: Parameters<typeof extractTableScalar>[4] = [];
        try {
          const data = await progress.run("selecting table cells", () =>
            extractTableScalar(
              {
                ...decisions!,
                recordDecisionUsage: (usage) => {
                  nativeUsage.inputTokens += usage.inputTokens;
                  nativeUsage.outputTokens += usage.outputTokens;
                  decisions?.recordDecisionUsage?.(usage);
                },
              },
              instruction,
              candidates!,
              progress,
              trace,
            ),
          );
          const valid = z.json().parse(schema.parse(data));
          nativeUsage.inferenceTimeMs = Math.round(performance.now() - started);
          logger.info("Table cell extraction accepted", { category: "decisions" });
          return {
            result: {
              data: valid,
              metadata: { usage: nativeUsage, cache: disabledCacheMetadata() },
            },
            cacheValue: valid,
          };
        } catch (error) {
          progress.throwIfStopped();
          if (decisions.llmFallback === false) throw error;
          nativeUsage.inferenceTimeMs = Math.round(performance.now() - started);
          logger.info("Table cell extraction fell back to the LLM", {
            category: "decisions",
            reason: error instanceof Error ? error.message : String(error),
          });
        } finally {
          logger.debug("Table cell extraction trace", {
            category: "decisions",
            trace: JSON.stringify(trace),
          });
        }
      }
    }
    if (decisions?.extract === "map" && instruction && !screenshot && !triedTableReader) {
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
            schema: jsonSchema,
            tree: combinedTree,
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
    const domElements =
      compactEvidenceExperiment &&
      !screenshot &&
      !/\[\d+-\d+\]|\b(?:element|node|dom)\s+ids?\b/i.test(`${instruction}\n${systemPrompt}`)
        ? compactExtractionTree(
            combinedTree,
            new Set(urlFieldPaths.length ? Object.keys(combinedUrlMap ?? {}) : []),
          )
        : combinedTree;
    if (compactEvidenceExperiment) {
      logger.debug("Extraction evidence size", {
        category: "decisions",
        snapshotCharacters: combinedTree.length,
        evidenceCharacters: domElements.length,
      });
    }

    const screenshotContent: LLMImageContent | undefined = screenshot
      ? {
          type: "image",
          data: bytesToBase64(screenshot),
          mimeType: "image/png",
        }
      : undefined;

    progress.throwIfStopped();
    const { data, usage, durationMs } = await inference.extract({
      instruction,
      domElements,
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
    });
    progress.throwIfStopped();

    let completed: boolean | undefined;
    if (
      decisions &&
      (decisions.extract === "judge" || decisions.extract === "pick") &&
      instruction
    ) {
      try {
        const trace: Parameters<typeof extractionCompleted>[0]["trace"] = [];
        const verdict = await extractionCompleted(
          {
            config: decisions,
            instruction,
            trace,
            threshold: 0.5,
            logger,
            ensureTimeRemaining: () => progress.throwIfStopped(),
          },
          data,
        );
        completed = verdict.completed;
        logger.info("Decisions extract completion", {
          category: "decisions",
          instruction,
          score: verdict.score,
          trace: JSON.stringify(trace),
        });
      } catch {
        // The verdict only affects logging. Cancellation still stops the extraction.
        progress.throwIfStopped();
      }
      progress.throwIfStopped();
    }

    const {
      inputTokens = 0,
      outputTokens = 0,
      reasoningTokens = 0,
      cachedInputTokens = 0,
    } = usage ?? {};
    let output: unknown = data;

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
      completed === undefined
        ? "Extraction result returned"
        : completed
          ? "Extraction completed successfully"
          : "Extraction incomplete after processing all data",
      {
        category: "extraction",
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        inferenceTimeMs: durationMs,
      },
    );

    return {
      result: {
        data: z.json().parse(output),
        metadata: {
          usage: {
            inputTokens: inputTokens + nativeUsage.inputTokens,
            outputTokens: outputTokens + nativeUsage.outputTokens,
            reasoningTokens,
            cachedInputTokens,
            inferenceTimeMs: durationMs + nativeUsage.inferenceTimeMs,
          },
          cache: disabledCacheMetadata(),
        },
      },
      cacheValue: output,
      llmUsage: {
        inputTokens,
        outputTokens,
        llmDurationMs: durationMs,
      },
    };
  }
}
