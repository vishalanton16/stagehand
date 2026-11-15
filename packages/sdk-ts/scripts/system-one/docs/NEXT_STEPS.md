# Next steps

The SDK keeps Decider's current mapper and one Luna fallback. The table-cell route remains available in benchmark builds. See [INDEX.md](./INDEX.md) for completed work and [EVALUATION.md](./EVALUATION.md) for measurement rules.

## Current experiment order

1. **Test mixed table and prose extraction.** Compare the current mapper, the all-or-nothing table route, and routing fields separately. Start by sending fields with a supported table cell to the table reader and the remaining fields to the mapper. Validate the complete schema before accepting. Measure whether one Luna fallback for unresolved fields reduces the cost of large mixed pages.
2. **Stress the table route on a separate fresh set.** Include grouped headers, repeated tables with conflicting values, absent cells, and schemas with weak field descriptions. Freeze graders before running. Count wrong direct accepts and missing valid fields separately from fallbacks.
3. **Decide whether to enable the route in the experimental SDK.** Require zero additional wrong direct accepts and an end-to-end cost or latency improvement. Report billed tokens and p95 for both the routed subset and the entire workload.

Completed experiments and archived implementations are linked from [the cleanup record](./DECISION_PRIMITIVES.md#active-extraction-paths). Scalar agreement strictness and the list tail-latency regression remain open in the [implementation status](./INDEX.md#plan-status).

## 9. Split into a reviewable stack

Suggested order, each PR targeting the previous one (see AGENTS.md):

1. Replay harness, corpus tooling and frozen held-out task definitions (no production code).
2. `dataView.ts` and `mapCopy.ts` in `packages/extension/services/decisions/`, with unit tests.
3. `extract: "map"` in `extractService.ts`, `scalarReader.ts`, the protocol enum and generated clients.
4. The absence instruction for LLM extraction, measured separately (`REVIEW.md`, M5).
5. Docs and README.
