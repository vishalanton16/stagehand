import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import { Stagehand } from "../../dist/index.mjs";
import type { StagehandLog } from "@browserbasehq/stagehand-protocol/types";
import {
  audit,
  cases,
  checkObservation,
  fixtureHtml,
  publicPages,
  readFixture,
  type Case,
} from "./cases.ts";
import { generateLuna, lunaModel, lunaTimeout, makeLuna, type LunaCall } from "./luna.ts";
import {
  buildIdentity,
  capture,
  chromeVersion,
  launch,
  loadArchive,
  msSince,
  navigate,
  pageEvidence,
  servePages,
  sha256,
  viewport,
} from "./pages.ts";
import { summarize, type RowOutcome } from "./summary.ts";

const timeout = 35_000;
const models = {
  luna: undefined,
  standard: "pplx-decider-v1.3",
  flash: "pplx-decider-flash-v1.3",
} as const;
type Arm = keyof typeof models;

const [mode, output, captureDir, ...args] = process.argv.slice(2);
if (
  !output ||
  args.length ||
  (mode !== "capture" && mode !== "live" && mode !== "replay") ||
  (mode === "replay") !== Boolean(captureDir)
) {
  throw new Error("Usage: run.ts capture NEW_CAPTURE | live NEW_RUN | replay NEW_RUN CAPTURE");
}

if (mode === "capture") {
  await capture(output);
} else {
  await run(mode, output, captureDir);
}

async function run(mode: "live" | "replay", dir: string, captureDir?: string) {
  const arms = parseSelection(
    process.env.SDK_ACCEPTANCE_ARMS ?? "luna,standard",
    Object.keys(models),
  ) as Arm[];
  const ids = process.env.SDK_ACCEPTANCE_CASES
    ? parseSelection(
        process.env.SDK_ACCEPTANCE_CASES,
        cases.map((task) => task.id),
      )
    : cases.map((task) => task.id);
  const selected = cases.filter((task) => ids.includes(task.id));
  const rounds = Number(process.env.SDK_ACCEPTANCE_ROUNDS ?? 2);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 6)
    throw new Error("SDK_ACCEPTANCE_ROUNDS must be an integer from 1 to 6");

  const key = process.env.PERPLEXITY_API_KEY;
  if (!key && arms.some((arm) => models[arm])) throw new Error("PERPLEXITY_API_KEY is required");
  const luna = makeLuna();
  const build = await buildIdentity();
  const archive = captureDir ? await loadArchive(captureDir) : undefined;
  const scripts = ["cases.ts", "luna.ts", "pages.ts", "run.ts", "summary.ts"];
  const scriptHashes = Object.fromEntries(
    await Promise.all(
      scripts.map(async (file) => [file, sha256(await readFile(new URL(file, import.meta.url)))]),
    ),
  );
  const manifest = {
    mode,
    build,
    scriptHashes,
    startedAt: new Date().toISOString(),
    node: process.version,
    viewport,
    timeout,
    lunaTimeout,
    lunaModel,
    decisionModels: models,
    arms,
    rounds,
    cases: selected.map(({ id, site, operation, instruction, expected }) => ({
      id,
      site,
      operation,
      instruction,
      expected,
    })),
    archiveManifestSha256: archive?.manifestSha256,
    fixtureSha256: sha256(fixtureHtml),
    selfHeal: false,
    cache: false,
  };
  await mkdir(dir, { mode: 0o700 });
  const writeJson = (file: string, data: unknown) =>
    writeFile(join(dir, file), JSON.stringify(data, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  await writeJson("run.json", manifest);
  const server = await servePages(archive);
  const rows = [];
  try {
    for (let round = 0; round < rounds; round++) {
      for (const [index, task] of selected.entries()) {
        const shift = (round + cases.indexOf(task)) % arms.length;
        const order = [...arms.slice(shift), ...arms.slice(0, shift)];
        for (const [position, arm] of order.entries()) {
          const controlled = task.site === "fixture" || mode === "replay";
          const url = controlled
            ? `${server.origin}/${task.site}`
            : publicPages[task.site as keyof typeof publicPages];
          const row = await trial(task, url, controlled, arm, round + 1, {
            key,
            luna,
            position: position + 1,
            index: index + 1,
          });
          rows.push(row);
          process.stdout.write(JSON.stringify(row) + "\n");
          await appendFile(join(dir, "trials.jsonl"), JSON.stringify(row) + "\n", { mode: 0o600 });
        }
      }
    }
  } finally {
    server.close();
  }
  if (!isDeepStrictEqual(build, await buildIdentity()))
    throw new Error("SDK build or HEAD changed during the run");
  await writeJson("summary.json", summarize(rows));
}

function parseSelection(input: string, allowed: string[]) {
  const values = input.split(",");
  if (new Set(values).size !== values.length || values.some((value) => !allowed.includes(value)))
    throw new Error(`Expected unique values from ${allowed.join(", ")}`);
  return values;
}

type Trial = RowOutcome & {
  at: string;
  position: number;
  caseIndex: number;
  phases: Record<string, number>;
  decisionReceipts: {
    offsetMs: number;
    inputTokens: unknown;
    outputTokens: unknown;
    model: unknown;
  }[];
  lunaCalls: LunaCall[];
  fallback?: { reason: string; offsetMs: number };
  chrome?: string;
  navigation?: Awaited<ReturnType<typeof navigate>>;
  sample?: Awaited<ReturnType<typeof pageEvidence>>;
  audit?: Awaited<ReturnType<typeof audit>>;
  usage?: unknown;
  result?: unknown;
  grade?: unknown;
  error?: { phase: string; name: string };
  gradingError?: string;
  cleanupError?: string;
};

async function trial(
  task: Case,
  url: string,
  controlled: boolean,
  arm: Arm,
  round: number,
  options: { key?: string; luna: ReturnType<typeof makeLuna>; position: number; index: number },
): Promise<Trial> {
  const row: Trial = {
    id: task.id,
    operation: task.operation,
    arm,
    round,
    at: new Date().toISOString(),
    position: options.position,
    caseIndex: options.index,
    status: "invalid",
    route: "unstarted",
    phases: {},
    decisionReceipts: [],
    lunaCalls: [],
  };
  const started = performance.now();
  let operationStart: number | undefined;
  let browser: Awaited<ReturnType<typeof launch>> | undefined;
  let phase = "launch";
  const decisionModel = models[arm];

  function onLog(log: StagehandLog) {
    if (operationStart === undefined) return;
    const offsetMs = msSince(operationStart);
    if (log.message === "Decision model usage") {
      const { inputTokens, outputTokens, model } = log.data;
      row.decisionReceipts.push({ offsetMs, inputTokens, outputTokens, model });
    }
    if (log.data.category === "decisions" && log.message.includes("fell back to the LLM")) {
      const value = typeof log.data.reason === "string" ? log.data.reason : "";
      // Error text may carry upstream content. Keep only the reason code or HTTP status.
      const reason = /^([a-z][a-z0-9_-]*(?::\d+)?)\b/.exec(value)?.[1] ?? "unclassified";
      const status = /request failed \((\d{3})\b|HTTP (\d{3})/i.exec(value);
      row.fallback = {
        offsetMs,
        reason: status ? `${reason}:http_${status[1] ?? status[2]}` : reason,
      };
    }
  }

  try {
    browser = await launch();
    row.phases.launchMs = msSince(started);
    phase = "init";
    const initStart = performance.now();
    const stagehand = await Stagehand.create({
      browser,
      cache: false,
      selfHeal: false,
      logging: { level: "info", onLog },
      model: {
        generate: (params) => generateLuna(options.luna, params, row.lunaCalls, operationStart!),
      },
      ...(decisionModel
        ? {
            experimentalDecisions: {
              provider: "perplexity",
              model: decisionModel,
              apiKey: options.key!,
            },
          }
        : {}),
    });
    row.phases.initMs = msSince(initStart);
    row.chrome = await chromeVersion(browser);
    phase = "navigation";
    const page = await browser.context.newPage();
    row.navigation = await navigate(page, url);

    phase = "input audit";
    const auditStart = performance.now();
    row.audit = await audit(page, task);
    row.phases.auditMs = msSince(auditStart);
    if (!row.audit.pass) return row;

    phase = "input snapshot";
    row.sample = await pageEvidence(page, !controlled);
    const sdk = decisionModel ? stagehand.experimentalDecisions : stagehand;
    const sdkOptions = { page, cache: false, timeout };
    phase = "operation";
    operationStart = performance.now();
    try {
      const result = await (task.operation === "act"
        ? sdk.act(task.instruction, sdkOptions)
        : task.operation === "observe"
          ? sdk.observe(task.instruction, sdkOptions)
          : sdk.extract(task.instruction, task.schema, sdkOptions));
      row.result = result.data;
      row.usage = result.metadata.usage;
    } catch (error) {
      if (task.operation !== "act") throw error;
      row.status = "error";
      row.error = { phase, name: error instanceof Error ? error.name : "Error" };
    } finally {
      row.sdkMs = msSince(operationStart);
      operationStart = undefined;
    }

    phase = "grading";
    const gradeStart = performance.now();
    try {
      if (task.operation === "act") {
        const actual = await readFixture(page);
        const effectCorrect = isDeepStrictEqual(actual, task.expected);
        const accepted = (row.result as { success: boolean } | undefined)?.success;
        row.grade = { accepted, effectCorrect, actual };
        row.wrongEffect = !effectCorrect && !isDeepStrictEqual(actual, row.audit.actual);
        if (row.status !== "error")
          row.status = accepted ? (effectCorrect ? "pass" : "wrong") : "failed";
      } else if (task.operation === "observe") {
        const grade = await checkObservation(
          page,
          task,
          row.result as Parameters<typeof checkObservation>[2],
        );
        row.grade = grade;
        row.status = !grade.labelStable ? "invalid" : grade.pass ? "pass" : "wrong";
      } else {
        const endAudit = await audit(page, task);
        row.grade = { endAudit };
        row.status = !endAudit.pass
          ? "invalid"
          : isDeepStrictEqual(row.result, task.expected)
            ? "pass"
            : "wrong";
      }
    } catch (error) {
      row.gradingError = error instanceof Error ? error.name : "Error";
      if (row.status !== "error") row.status = "invalid";
    } finally {
      row.phases.gradingMs = msSince(gradeStart);
    }
  } catch (error) {
    row.status = phase === "operation" ? "error" : "invalid";
    row.error = { phase, name: error instanceof Error ? error.name : "Error" };
  } finally {
    if (row.sdkMs !== undefined)
      row.route = !decisionModel
        ? "ordinary"
        : row.fallback || row.lunaCalls.length
          ? "fallback"
          : row.status === "error"
            ? "undetermined"
            : "direct";
    const cleanupStart = performance.now();
    try {
      await browser?.close();
    } catch (error) {
      row.cleanupError = error instanceof Error ? error.name : "Error";
    }
    row.phases.cleanupMs = msSince(cleanupStart);
    row.phases.totalMs = msSince(started);
  }
  return row;
}
