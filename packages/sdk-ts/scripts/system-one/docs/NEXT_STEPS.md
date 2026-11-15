# Next steps

These tasks are ordered and each is small enough for one PR or one session. Each has a done condition. Follow [EVALUATION.md](./EVALUATION.md) for anything that produces a number. See [INDEX.md](./INDEX.md) for the full doc set.

Product shape (decided): **one System One model (Decider by default) plus one LLM fallback (Luna).** Two System One models in parallel is an experiment, not the product.

## Current experiment order

Keep the dual group gate in the SDK. Single choice caused two wrong direct accepts on fresh pages. Appending candidates to every request lost one regression result. The completed variants are archived. Pin the decision model versions in comparisons, including Jev 1.14.0. The [research and archives](./DECISION_PRIMITIVES.md) record the evidence behind these decisions.

1. **Test retrieval after abstention.** Compare the original shortlist with a retry that adds previously unseen groups. Include a control where only the retry contains the right group and a negative where neither shortlist contains it. Count wrong group accepts separately from wrong extraction results. Treat an added wrong accept as a blocker for promotion.
2. **Measure the retry through the live SDK.** After the missing-evidence check, use fresh pages that exercise direct acceptance, successful retry, and retry followed by Luna. Rotate arm order and report direct, retry, and fallback latency and provider usage. Keep the retry experimental until correctness and p95 hold on fresh data.
3. **Preserve exact list text.** Test rendered inline adjacency against the captured accessibility text and the matched DOM node. Start with the GitHub qualifier case and add punctuation and whitespace controls. Verify the full value, including its prefix and slash.
4. **Compare bounded scalar readers.** Freeze real-page evidence and test copy, Locate, and Clairic separately. Score field presence, source span, and typed normalization, including explicit zero and inferred values. Record Clairic passes and billed tokens.

The abstention and source-coverage experiments are complete. The coverage check caught both incomplete Python docs results, preserved all four positive controls in the full probe, and passed the 37-task paired replay. The live comparison is complete. Retry reduced fallback and median latency, and both Decision arms missed the same row on W3C in all three rounds. The heading fix recovered the missing row and preserved section filtering in the merged-table control. The follow-up passed on two fresh pages, with retries observed on known controls. The five-page promotion check produced zero retries and no difference in fallback count. Keep current Decider with Luna fallback. Move to exact text and span copying in step 3, starting with the SQLite function names and GitHub qualifiers. Revisit retry when fresh tasks can exercise explicit abstention and group disagreement separately. See the [promotion check](./DECISION_PRIMITIVES.md#fresh-retry-promotion-check).

## 1. Regression run on the seen sets

The production pipeline (`runtime-decider`) has never been run on dev, held1, held2 or held3 since its behaviour changed (see `REVIEW.md`, H1).

```sh
cat > /tmp/seen.mts <<'EOF'
const dir = `${process.cwd()}/packages/sdk-ts/scripts/system-one`;
const sets = await Promise.all([
  import(`${dir}/corpus.ts`).then((m) => m.tasks),
  import(`${dir}/heldout.ts`).then((m) => m.heldoutTasks),
  import(`${dir}/heldout2.ts`).then((m) => m.heldout2Tasks),
  import(`${dir}/heldout3.ts`).then((m) => m.heldout3Tasks),
]);
console.log(sets.flat().map((task) => task.name).join(","));
EOF
SEEN=$(node --import tsx /tmp/seen.mts)
REPLAY_ARMS=runtime-decider,luna REPLAY_TASKS=$SEEN REPLAY_ROUNDS=2 \
  node --env-file=.env --import tsx packages/sdk-ts/scripts/system-one/replay.ts
```

Two seen tasks (`apartments`, `npm_zod`) have no snapshot. Replay rejects missing snapshots, so drop them from the list if it refuses to start.

Done when:
- the per-task results are compared with `runs/s1-seen.jsonl` (arm `s1-decider`);
- every newly failing task and every newly escalated task has a written cause;
- the README states the seen-set pass count, fallback rate and wrong-accept count.

## 2. Remove the unused verifier call from production

Split `verifyResult` into `structuralProblems()` (code only) and an optional `askVerifier()` (one decision call). `extractService` should use only the structural part. Keep the model check available to replay as a separate arm.

Done when:
- production `map` mode makes one fewer decision request per extraction;
- the H1 run shows no change in accepted-and-correct counts;
- `live.ts` latency is re-measured.

## 3. Cut sequential round trips

Count decision requests per extraction from the trace and make each shape need fewer of them:
- **Scalars:** start the Locate reading in parallel with the fact-choice request; it only needs the fact sheet, which exists before any model call.
- **Lists:** fold the number-position question into the field-mapping request where the sample values are already known. Skip the per-record "not a total or heading" request when the group has no header-like records.
- Keep the isolated-questions property: one request may carry many questions without them influencing each other.

Done when replay reports mean and p95 decision requests per extraction before and after, and accuracy on the seen sets is unchanged.

## 4. Fix instruction plumbing

Pass only the user instruction to `mapCopyExtract` (`REVIEW.md`, H3). If system-prompt context is needed, add a separate `context` field that ranking and `countOptions` ignore.

Done when a unit test shows a number in the system prompt doesn't create a count option.

## 5. Logging and trace hygiene

- At info level, log only `accepted` or `fallback`, the problem reasons and the number of decision requests.
- Put the full trace (with copied text) at debug level.
- Aggregate per-record `missing:` problems into one entry per field with a count (`REVIEW.md`, M1 and M3).

## 6. Decide the strictness of the cross-checks with data

Using the step 1 results, choose between exact and normalized-containment `sameValue` (`REVIEW.md`, M2), and pick a threshold for missing required list values. Record the decision and the numbers behind it.

## 7. Fresh held-out set 5

Build it per `EVALUATION.md`: new sites only, instructions written before capture, graders written from snapshots before any run, no changes after the first run. It should include:
- nested sections (region, then subsection, then list);
- look-alike tables;
- absent optional fields and explicit zeros;
- ambiguous fields (two plausible counts);
- cells holding several values or units;
- long lists (over 200 rows);
- at least three scalar-only pages.

Run `luna`, `runtime-decider` and `runtime-flash` once, two rounds. Report pass rate, fallback rate, wrong accepts, and p50 and p95 latency. This is the first honest measurement of the production pipeline.

## 8. Live end-to-end measurement on real pages

`live.ts` uses six synthetic fixtures. Add a live runner over a subset of real held-out URLs that measures wall-clock time through the public SDK, including snapshot capture. That's where the latency claim has to hold.

## 9. Split into a reviewable stack

Suggested order, each PR targeting the previous one (see AGENTS.md):

1. Replay harness, corpus tooling and frozen held-out task definitions (no production code).
2. `dataView.ts` and `mapCopy.ts` in `packages/extension/services/decisions/`, with unit tests.
3. `extract: "map"` in `extractService.ts`, `scalarReader.ts`, the protocol enum and generated clients.
4. The absence instruction for LLM extraction, measured separately (`REVIEW.md`, M5).
5. Docs and README.
