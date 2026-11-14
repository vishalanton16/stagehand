import * as extractService from "../../../extension/services/extractService.js";
import { generateWithOpenAI } from "../openaiStructuredGeneration.js";
import { env } from "node:process";
import { z } from "zod/v4";
import { mapCopyExtract, type ScalarReader } from "./mapCopy.js";
import { groupLabels } from "./groupLabels.js";
import {
  cost,
  gateway,
  decisionConfigs,
  lunaExtract,
  withUsage,
  type Arm,
  type Usage,
} from "./replay.js";

function count(usage: Usage, input: number, output: number) {
  usage.calls++;
  usage.inputTokens += input;
  usage.outputTokens += output;
}

/** Perplexity Decider `locate`: the best-scoring span per field. */
function locateReader(model: string, usage: Usage): ScalarReader {
  return async ({ sheet, fields }) => {
    const response = await fetch("https://api.perplexity.ai/v1/decisions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        state: sheet,
        questions: Object.fromEntries(
          fields.map((field) => [
            field.name,
            {
              type: "locate",
              instructions:
                field.type === "number"
                  ? `${field.instructions}\nReturn the number as written, without surrounding text.`
                  : field.instructions,
            },
          ]),
        ),
      }),
    });
    if (!response.ok) throw new Error(`locate HTTP ${response.status}`);
    const body = (await response.json()) as {
      answers: Record<string, { spans: { text: string; score: number }[] }>;
      usage: { input_tokens: number; output_tokens: number };
    };
    count(usage, body.usage.input_tokens, body.usage.output_tokens);
    return Object.fromEntries(
      fields.map((field) => [
        field.name,
        body.answers[field.name]?.spans.toSorted((a, b) => b.score - a.score)[0]?.text,
      ]),
    );
  };
}

/** Cloudflare Clairic typed field extraction. */
function clairicReader(usage: Usage): ScalarReader {
  return async ({ sheet, fields }) => {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID!)}/ai/run/@cf/cloudflare/clairic`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.CLOUDFLARE_AUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "clairic",
          state: sheet,
          fields: Object.fromEntries(
            fields.map((field) => [
              field.name,
              {
                type: field.type === "number" ? "number" : "text",
                instructions: field.instructions,
              },
            ]),
          ),
        }),
      },
    );
    if (!response.ok) throw new Error(`clairic HTTP ${response.status}`);
    const body = (await response.json()) as {
      result: {
        answers: Record<string, { value: unknown }>;
        usage: { input_tokens: number; output_tokens: number };
      };
    };
    count(usage, body.result.usage.input_tokens, body.result.usage.output_tokens);
    return Object.fromEntries(
      fields.map((field) => {
        const value = body.result.answers[field.name]?.value;
        return [field.name, typeof value === "string" || typeof value === "number" ? value : null];
      }),
    );
  };
}

function mapCopy(
  model: keyof typeof decisionConfigs,
  rate: Arm["rate"],
  reader?: (usage: Usage) => ScalarReader,
): Arm {
  return {
    rate,
    run: async ({ task, frozen, usage, notes }) => {
      const { data } = await mapCopyExtract(withUsage(decisionConfigs[model], usage), {
        instruction: task.instruction,
        schema: z.toJSONSchema(task.schema) as Parameters<typeof mapCopyExtract>[1]["schema"],
        tree: frozen.tree,
        urlMap: frozen.urlMap,
        trace: notes as never[],
        reader: reader?.(usage),
        verify: true,
      });
      return data;
    },
  };
}

function normalize(value: unknown): unknown {
  if (typeof value === "string") return value.trim().replace(/\s+/g, " ").toLowerCase();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, normalize(item)]),
    );
  return value;
}

type Member = {
  model: keyof typeof decisionConfigs;
  rate: Arm["rate"];
  reader?: (usage: Usage) => ScalarReader;
};

/**
 * Two independent System One readings run in parallel; the result is accepted
 * only when both agree after normalization, otherwise the page goes to Luna.
 * Agreement is a stronger correctness signal than either model's self-check.
 */
function agreement(a: Member, b: Member): Arm {
  return {
    rate: "luna",
    run: async (context) => {
      const usages = [a, b].map((): Usage => ({
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
      }));
      const readings = await Promise.allSettled(
        [a, b].map((member, i) =>
          mapCopy(member.model, member.rate, member.reader).run({
            ...context,
            usage: usages[i]!,
            notes: [],
          }),
        ),
      );
      let usd = cost(a.rate, usages[0]!) + cost(b.rate, usages[1]!);
      for (const usage of usages) {
        context.usage.calls += usage.calls;
        context.usage.inputTokens += usage.inputTokens;
        context.usage.outputTokens += usage.outputTokens;
      }
      const [x, y] = readings;
      const agreed =
        x.status === "fulfilled" &&
        y.status === "fulfilled" &&
        JSON.stringify(normalize(x.value)) === JSON.stringify(normalize(y.value));
      if (agreed) {
        context.notes.push({ step: "cascade", decision: "accept" }, { step: "cost", usd });
        return x.value;
      }
      const luna: Usage = { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
      const data = await lunaExtract(
        { task: context.task, usage: luna },
        context.frozen.tree,
        context.frozen.urlMap,
      );
      usd += cost("luna", luna);
      context.usage.calls += luna.calls;
      context.usage.inputTokens += luna.inputTokens;
      context.usage.outputTokens += luna.outputTokens;
      context.usage.cachedInputTokens += luna.cachedInputTokens;
      context.notes.push({ step: "cascade", decision: "escalate" }, { step: "cost", usd });
      return data;
    },
  };
}

/**
 * The product shape: one System One model maps and copies; Luna takes over when
 * the verdict reports a problem (two readings disagree, counts fall short,
 * required values are missing) or extraction fails outright.
 */
function systemOne(
  model: keyof typeof decisionConfigs,
  rate: Arm["rate"],
  locateModel?: string,
): Arm {
  return {
    rate: "luna",
    run: async (context) => {
      const own: Usage = { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
      const trace: unknown[] = [];
      let data: Record<string, unknown> | undefined;
      let problems: string[] = [];
      let agree = 0;
      try {
        const result = await mapCopyExtract(withUsage(decisionConfigs[model], own), {
          instruction: context.task.instruction,
          schema: z.toJSONSchema(context.task.schema) as Parameters<
            typeof mapCopyExtract
          >[1]["schema"],
          tree: context.frozen.tree,
          urlMap: context.frozen.urlMap,
          trace: trace as never[],
          reader: locateModel ? locateReader(locateModel, own) : undefined,
          readerChecks: true,
          verify: true,
        });
        data = result.data;
        problems = result.verdict?.problems ?? [];
        agree = result.verdict?.agree ?? 0;
      } catch (error) {
        problems = [`error:${error instanceof Error ? error.message.slice(0, 80) : String(error)}`];
      }
      const ownPassed = data !== undefined && context.task.grade(data) === undefined;
      let usd = cost(rate, own);
      Object.assign(context.usage, {
        calls: own.calls,
        inputTokens: own.inputTokens,
        outputTokens: own.outputTokens,
      });
      context.notes.push(
        { step: "system-one", passed: ownPassed, problems, agree, data },
        ...trace,
      );
      if (data && problems.length === 0) {
        context.notes.push({ step: "cascade", decision: "accept" }, { step: "cost", usd });
        return data;
      }
      const luna: Usage = { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
      const fallback = await lunaExtract(
        { task: context.task, usage: luna },
        context.frozen.tree,
        context.frozen.urlMap,
      );
      usd += cost("luna", luna);
      context.usage.calls += luna.calls;
      context.usage.inputTokens += luna.inputTokens;
      context.usage.outputTokens += luna.outputTokens;
      context.usage.cachedInputTokens += luna.cachedInputTokens;
      context.notes.push({ step: "cascade", decision: "escalate" }, { step: "cost", usd });
      return fallback;
    },
  };
}

const decider: Member = { model: "decider", rate: "decider" };
const flash: Member = { model: "flash", rate: "flash" };
const jev: Member = { model: "jev", rate: "jev" };

/** New extraction designs under test; each is compared against the arms in replay.ts. */
function runtimeMap(
  model: "decider" | "flash",
  {
    speculateListMapping = false,
    experiment,
  }: {
    speculateListMapping?: boolean;
    experiment?: "baseline" | "schema" | "oracle";
  } = {},
): Arm {
  return {
    rate: model,
    run: async (context) => {
      let llmCalls = 0;
      const decisionUsage: Usage = {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
      };
      const llmUsage: Usage = { ...decisionUsage };
      const oracleGroup = groupLabels[context.task.name]?.oracle;
      if (experiment === "oracle" && !oracleGroup)
        throw new Error(`Missing oracle group for ${context.task.name}`);
      const result = await extractService.extract({
        params: {
          pageId: "replay",
          instruction: context.task.instruction,
          schema: z.json().parse(z.toJSONSchema(context.task.schema)),
          options: { cache: false, timeout: 60_000 },
        },
        page: {
          captureSnapshot: async () => ({
            combinedTree: context.frozen.tree,
            combinedXpathMap: context.frozen.xpathMap,
            combinedUrlMap: context.frozen.urlMap,
          }),
          screenshot: async () => new Uint8Array(),
        },
        model: { source: "client" },
        decisions: {
          ...decisionConfigs[model],
          ...(experiment ? { model: "pplx-decider-v1.3" } : {}),
          extract: "map",
          recordDecisionUsage: ({ inputTokens, outputTokens }) => {
            count(decisionUsage, inputTokens, outputTokens);
            count(context.usage, inputTokens, outputTokens);
          },
        },
        clientLLMGenerate: (params) => {
          llmCalls++;
          context.usage.calls++;
          return generateWithOpenAI(
            gateway,
            env.AI_GATEWAY_MODEL ?? "openai/gpt-6-luna",
            params,
            (usage) => {
              count(llmUsage, usage.inputTokens, usage.outputTokens);
              llmUsage.cachedInputTokens += usage.cachedInputTokens ?? 0;
            },
          );
        },
        logger: context.logger,
        speculateListMapping,
        groupExperiment:
          experiment === "oracle" && oracleGroup
            ? { oracleGroup }
            : experiment === "schema"
              ? experiment
              : undefined,
      });
      Object.assign(context.usage, {
        inputTokens: result.metadata.usage.inputTokens,
        outputTokens: result.metadata.usage.outputTokens,
        cachedInputTokens: result.metadata.usage.cachedInputTokens,
      });
      context.notes.push({
        step: "cascade",
        decision: llmCalls ? "escalate" : "accept",
        decisionRequests: decisionUsage.calls,
        llmCalls,
      });
      context.notes.push({
        step: "cost",
        usd:
          llmCalls === llmUsage.calls ? cost(model, decisionUsage) + cost("luna", llmUsage) : null,
        decisionUsage,
        llmUsage,
      });
      return result.data;
    },
  };
}

export const extraArms: Record<string, Arm> = {
  "runtime-decider": runtimeMap("decider"),
  "runtime-decider-speculative": runtimeMap("decider", { speculateListMapping: true }),
  "runtime-flash": runtimeMap("flash"),
  "runtime-decider-v13": runtimeMap("decider", { experiment: "baseline" }),
  "runtime-decider-v13-schema": runtimeMap("decider", {
    experiment: "schema",
    speculateListMapping: true,
  }),
  "runtime-decider-v13-schema-sequential": runtimeMap("decider", { experiment: "schema" }),
  "s1-decider": systemOne("decider", "decider", "pplx-decider-latest"),
  "s1-flash": systemOne("flash", "flash", "pplx-decider-flash-latest"),
  "s1-jev": systemOne("jev", "jev"),
  "agree-decider-flash": agreement(decider, flash),
  "agree-decider-jev": agreement(decider, jev),
  "agree-locate": agreement(
    { ...decider, reader: (usage) => locateReader("pplx-decider-latest", usage) },
    { ...flash, reader: (usage) => locateReader("pplx-decider-flash-latest", usage) },
  ),
  "map-jev": mapCopy("jev", "jev"),
  "map-clef": mapCopy("clef", "clef"),
  "map-decider": mapCopy("decider", "decider"),
  "map-flash": mapCopy("flash", "flash"),
  "map-decider-locate": mapCopy("decider", "decider", (usage) =>
    locateReader("pplx-decider-latest", usage),
  ),
  "map-flash-locate": mapCopy("flash", "flash", (usage) =>
    locateReader("pplx-decider-flash-latest", usage),
  ),
  "map-clef-clairic": mapCopy("clef", "clef", clairicReader),
};

export const oracleArm = runtimeMap("decider", { experiment: "oracle" });
