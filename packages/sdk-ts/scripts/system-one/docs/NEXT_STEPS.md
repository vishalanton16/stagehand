# Next steps

Current cleanup status: see [CLEANUP_RESULTS.md](./CLEANUP_RESULTS.md). Prototype flags and source paths below describe the measured pre-cleanup implementations unless stated otherwise. Historical results and caveats are preserved.

The SDK keeps Decider's current mapper and one Luna fallback. The table-cell route remains available in benchmark builds. See [INDEX.md](./INDEX.md) for completed work and [EVALUATION.md](./EVALUATION.md) for measurement rules.

## Current experiment order

1. **Reassess Decider against single-call Luna on fresh live pages.** Compare raw Luna, compact Luna, and Decider with compact Luna fallback. Keep URL lists, partial results, and absent optional fields in the workload. Report cache reads, accuracy, cost, and p95 for the same tasks and rounds, including separate direct-accept and fallback timings.
2. **Resume table-cell validation independently.** Include grouped headers, competing tables, weak field descriptions, and absent required cells. Freeze graders before running. Count wrong direct accepts and report the routed subset alongside the full workload.

Completed experiments and archived implementations are linked from [the cleanup record](./DECISION_PRIMITIVES.md#active-extraction-paths). Scalar agreement strictness and the list tail-latency regression remain open in the [implementation status](./INDEX.md#plan-status).

## Action experiments

The [complete-action policy](./ACT_RESULTS.md) passed its second fresh live batch with Decider and the subsequent paired Flash comparison. It remains opt-in as `act: "plans"`. The current evidence covers bounded clicks and literal fills with Luna fallback, plus two short workflows. Next, broaden rich editors, frames, ambiguous instructions and multi-step actions. Keep the [frozen-label protocol](./ACT_EXPERIMENTS.md) and the old tree/Luna controls. Cache healing, vision and readiness still need separate experiments.

## 9. Split into a reviewable stack

Suggested order, each PR targeting the previous one (see AGENTS.md):

1. Replay harness, corpus tooling and frozen held-out task definitions (no production code).
2. `dataView.ts` and `mapCopy.ts` in `packages/extension/services/decisions/`, with unit tests.
3. `extract: "map"` in `extractService.ts`, `scalarReader.ts`, the protocol enum and generated clients.
4. The absence instruction for LLM extraction, measured separately (`REVIEW.md`, M5).
5. Docs and README.
