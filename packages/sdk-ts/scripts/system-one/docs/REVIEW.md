# Review: uncommitted System One changes

Current cleanup status: see [CLEANUP_RESULTS.md](./CLEANUP_RESULTS.md). Prototype flags and source paths below describe the measured pre-cleanup implementations unless stated otherwise. Historical results and caveats are preserved.

Reviewed on November 14, 2026, against commit `632789220` ("Benchmark System One extraction with LLM fallback").

## Summary

The uncommitted work turns the map-and-copy benchmark prototype into a production extraction mode, `experimentalDecisions.extract: "map"`. The design is the one the benchmark supports:

1. Stagehand builds a data view of the page.
2. One decision model maps schema fields onto it.
3. Code copies the values.
4. The result goes to the configured LLM whenever a check reports a problem.

The move is well executed:

- **One implementation.** Production and replay share it; `scripts/system-one/dataView.ts` and `mapCopy.ts` are now re-exports of `packages/extension/services/decisions/`.
- **Safe acceptance.** Output is accepted only if it validates against the caller's schema and the verdict has no problems.
- **Failure handling.** Deadlines propagate, and `llmFallback: false` turns a fallback into an abstention error.
- **Provenance.** Every copied value carries source node IDs and a record ID in the trace.
- **Tests and archives.** Unit tests cover explicit zero, absent optional and nullable fields, schema mismatch, fallback usage and deadlines. Replay runs are archived with revision, source and snapshot hashes.

Verified locally: `tsc` passes for `packages/extension` and `packages/sdk-ts`, and the three new test files pass (9 tests).

Not verified: the behaviour changes listed below have only been measured on heldout-4 (the regression run that informed the fixes) and on six synthetic live fixtures. Nobody has re-run them on the 49 seen tasks (dev, held1–held3). Treat that as the first open item.

## Findings

### High

**H1. No regression run after behaviour changes.**
The move changed behaviour in several places, not just imports:

- exact equality for the Locate cross-check;
- required missing values become problems or errors instead of `""`;
- empty list items are no longer dropped;
- heading-scoped candidate groups;
- the `finer` filter needs only one well-covered slot instead of two.

The archives under `runs/archive/` cover heldout-4 (11 tasks), four focus tasks and one single-task run. The last full seen-set measurement (`runs/s1-seen.jsonl`, arm `s1-decider`) predates all of these changes.

Run `REPLAY_ARMS=runtime-decider` on dev, held1, held2 and held3 for two rounds before relying on the README numbers. Compare with `s1-seen.jsonl` task by task.

**H2. The verifier model call runs on every extraction but its answer is never used.**
`extractService.ts` passes `verify: true`, which makes `verifyResult` send one more decision request: the yes/no "is this result correct and complete?". Only `verdict.problems` decides acceptance; `verdict.agree` is ignored.

The benchmark already showed that the self-check doesn't separate right from wrong answers on seen data. Correct results scored as low as 0.003, and the one wrong accepted result scored 0.9.

The call adds a sequential round trip to every extraction. It probably contributes to the live result in the README: 9.3 s for Decider plus fallback against 4.1 s for Luna. Fix: split `verifyResult` into structural checks (code only) and an optional model check, and turn the model check off in production.

**H3. The system prompt is merged into the instruction the mapper sees.**
The call `mapCopyExtract(config, { instruction: [systemPrompt, instruction].join("\n") })` feeds the system prompt into everything that reads the instruction:

- `countOptions`, so numbers in a system prompt become candidate item counts;
- `tokens()`-based ranking of groups, slots and facts;
- the text of every decision question.

Fix: pass only the user instruction to the mapper, or pass the system prompt as a separate field that ranking and count detection ignore.

### Medium

**M1. Full mapping trace logged at info level.**
`logger.info("System One extraction accepted"/"fell back", { trace: JSON.stringify(trace) })` writes page-derived text into logs on every call: reader values, section labels, choices. That's a log-volume and privacy concern for an SDK. Log only the decision, the problem reasons and the counts at info level, and the full trace at debug.

**M2. Exact `sameValue` makes the Locate cross-check stricter.**
The prototype accepted containment ("Austen, Jane" vs "Austen, Jane, 1775-1817"). Exact equality after whitespace and case normalization will raise more `scalar-disagree` fallbacks. It's safer for correctness, but the fallback-rate cost is unmeasured. Decide with H1 data. A middle ground: normalize punctuation and thousands separators, and accept containment only when the shorter value covers most of the longer one.

**M3. One problem per record for missing required list fields.**
`missing:${list}.${field}:${record.id}` is pushed for every record. Zod object fields are required by default, so a column that is legitimately sparse sends the whole extraction to the fallback. On long lists it also produces hundreds of problem strings. Aggregate into one problem per field with a count, and consider a threshold (for example, more than 10% of records) before treating it as a failure.

**M4. Required non-nullable strings that are absent now throw `unresolved`.**
This is intended: no invented `""`. But tasks whose correct answer is "not on the page" (`geniusee_2`, `aigrant_2`) now always fall back. Document it in the README. It means `map` mode can only answer an absence directly when the schema marks the field optional or nullable.

**M5. The absence instruction for the fallback is scoped to `map` mode.**
The fallback LLM gets "Absence is not zero …" only when `extract === "map"`. Replay's `lunaExtract` now always sends the same instruction, so old Luna baselines (`heldout4.jsonl`, `s1-seen.jsonl`) aren't comparable with new runs.

This is an LLM-extraction fix that is independent of System One. Consider a separate change for all `extract()` calls, with its own before/after measurement.

**M6. Heading-scoped groups multiply candidates.**
Measured with `buildDataView` on the frozen corpus:

| Page             | Groups before | Groups after |
| ---------------- | ------------- | ------------ |
| Craigslist       | 28            | 96           |
| MDN status codes | 19            | 36           |
| Apollo 11        | 413           | 470          |

Build time barely moved; the largest page went from 343 ms to 451 ms. But `rankGroups` keeps only the top 8, so on heading-heavy pages a real list can now be pushed out of the candidate set. Add a diagnostic for "the gold group was not among the candidates" in replay, and watch it.

**M7. The scalar second reading exists only for Perplexity.**
`scalarReader` returns `undefined` for other providers, so TypeSafe and Cloudflare scalars get no cross-check. On heldout-4, Jev accepted 5 wrong results, mostly scalars. The README says the other providers "also work"; it should say they lack the scalar check and have a weaker gate.

### Low

- **L1.** `systemOneDataView.test.ts` lives in `packages/sdk-ts/tests` but tests extension code through the script re-export. Move it next to the other System One tests in `packages/extension/tests`.
- **L2.** The README mentions "Heldout-5 logs from the earlier experiment" that have no task definitions in the checkout. Remove the sentence or add the definitions; unexplained artifacts invite wrong conclusions.
- **L3.** `live.ts` fixtures are tiny pages. Latency there measures the number of round trips, not page size. Don't generalize its timings to real pages.
- **L4.** The protocol enum change (`"map"`) is reflected in `stagehand.v4.json` and the generated Python types. Clients generated outside this repository (the Go SDK) will need regeneration before they can send `"map"`.
- **L5.** `runtimeMap` in `arms.ts` detects fallback by counting `clientLLMGenerate` calls. That works today, but it breaks silently if the LLM path ever makes zero or several calls. Prefer an explicit signal from `extractService` (for example, a field in `metadata`).
- **L6.** `finer` changed from requiring two well-covered slots to one. The change isn't explained anywhere; record why in a comment or the PR description.

## What I would ask for before merging

1. The H1 regression run, with any new seen-set failures explained.
2. H2 and H3 fixed, then the live latency check repeated.
3. M1 log levels adjusted.
4. README updated for M4, M7 and L2.
