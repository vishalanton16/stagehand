import type { Variables } from "@browserbasehq/stagehand-protocol/types";
import type { StagehandLogger } from "../../logger.js";
import type { Page } from "../../understudy/page.js";
import type { Progress } from "../../understudy/progress.js";
import { readFacts } from "./actionFacts.js";
import type { DecisionsConfig } from "./config.js";
import {
  observationSignature,
  observationView,
  type ObservationSnapshot,
} from "./observeCandidates.js";
import { selectObservation, type ObservationOutcome } from "./observeSelection.js";
import { redactor } from "./args.js";

type ObserveDeps = {
  page: Pick<Page, "captureSnapshot" | "evaluate" | "url">;
  logger: StagehandLogger;
  instruction?: string;
  variables?: Variables;
  systemPrompt?: string;
  snapshotOptions: Parameters<Page["captureSnapshot"]>[0];
  progress: Progress;
};
export async function runDecisionsObserve(
  config: DecisionsConfig,
  deps: ObserveDeps,
): Promise<ObservationOutcome & { inferenceTimeMs: number }> {
  let inferenceTimeMs = 0;
  const snapshot = async (): Promise<ObservationSnapshot> => {
    const snap = await deps.page.captureSnapshot(deps.snapshotOptions, deps.progress);
    const facts = await deps.progress.run("reading observation evidence", () =>
      deps.page.evaluate(readFacts, snap.combinedXpathMap),
    );
    return {
      formattedTree: snap.combinedTree,
      xpathMap: snap.combinedXpathMap,
      urlMap: snap.combinedUrlMap,
      facts,
      editableIds: snap.combinedEditableIds ?? [],
      url: deps.page.url(),
    };
  };
  try {
    // Custom instructions retain their full ordinary-observe interpretation until separately evaluated.
    if (deps.systemPrompt)
      return { kind: "fallback", reason: "custom_instructions", inferenceTimeMs };
    const before = await snapshot();
    deps.progress.throwIfStopped();
    const started = performance.now();
    let outcome: ObservationOutcome;
    try {
      outcome = await deps.progress.run("waiting for observation decisions", () =>
        selectObservation(
          {
            ...config,
            signal: config.signal
              ? AbortSignal.any([config.signal, deps.progress.signal])
              : deps.progress.signal,
          },
          before,
          deps.instruction,
          deps.variables,
        ),
      );
    } finally {
      inferenceTimeMs = Math.round(performance.now() - started);
    }
    deps.progress.throwIfStopped();
    if (outcome.kind === "done") {
      const after = await snapshot();
      // Checking the whole candidate universe also detects added matches and invalidated empty results.
      if (
        observationSignature(observationView(before)) !==
        observationSignature(observationView(after))
      )
        return { kind: "fallback", reason: "observation_evidence_changed", inferenceTimeMs };
    }
    return { ...outcome, inferenceTimeMs };
  } catch (error) {
    deps.progress.throwIfStopped();
    const reason = (redactor(deps.variables) ?? ((text: string) => text))(
      error instanceof Error ? error.message : String(error),
    );
    return { kind: "fallback", reason: `decision_error:${reason}`, inferenceTimeMs };
  } finally {
    deps.logger.debug("Decisions observe completed", { category: "decisions", inferenceTimeMs });
  }
}
