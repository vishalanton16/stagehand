# Observe experiment results

Measured November 15–16, 2026. The observe cleanup replaces the old observer with bounded single-target and complete-set decisions, automatic ordinary-LLM fallback, and a fresh candidate-evidence check before returning. The act/extract partial commit `7bd1902c2` is unchanged. The remaining cleanup commit includes the observer and its legacy dependency removals. Measurements were captured before that commit; the archived manifests retain that provenance.

The final Flash-backed public SDK comparison passed **22/22** observations on 11 tasks across three domains, matching its paired Luna control. Median SDK observe time fell from **1,426 ms to 437 ms**, and p95 from **2,233 ms to 1,965 ms**. All eight observe-then-act fill checks passed across both arms. This is a 69% median and 12% p95 reduction on this workload, not a general browser-agent claim.

Default Decider remains `pplx-decider-v1.3`. Flash requires explicit `model: "pplx-decider-flash-v1.3"`. The model setting applies to the whole experimental namespace, including act/extract. The comparisons below do not justify silently changing their default model.

## What changed after research

Research used web search and primary docs, cookbooks, blogs and public PR pages. No Context7 calls. Read [TypeSafe/Cloudflare research](./OBSERVE_TYPESAFE_CLOUDFLARE_RESEARCH.md) and [OpenAI/Perplexity research](./OBSERVE_OPENAI_PERPLEXITY_RESEARCH.md) for quotes, dated URLs and uncertainties.

- A single choice ranks alternatives. It cannot encode membership in a complete result set. Observe needs separate one-target, all-target, empty and discovery policies.
- Candidate discovery precedes model accuracy. A role-only filter omitted `input, file` and produced a false empty result. Native DOM controls now supplement AX roles. A regression test and two public upload pages cover the correction.
- Each membership question needs its candidate's context. Putting every competing candidate in shared state made the eager request expensive. The retained representation keeps the instruction in state and the relevant evidence with each question.
- One target uses choice plus an independent existence predicate. Several targets use one predicate per candidate; any uncertain membership escalates the complete request. No top-30 list is presented as "all".
- No-instruction discovery enumerates represented interactive controls without model inference. It deduplicates normalized selectors and retains DOM order.
- Observation is read-only, but its output can become a stale action. A second capture checks the whole candidate universe, including replacements, changed evidence and newly added matches. Checking selected elements alone would miss incomplete sets and invalidated empty results.
- Exact method/arguments still matter. Known literal fills and normal target methods are constructed in code. Unsupported operations, unbounded arguments, other readable content, custom system instructions and unresolved browser evidence use ordinary observe.

TypeSafe's companion-Noul guidance informed absence handling. Clef's joint attention means packing remains provider-dependent. Clairic and Locate are readers, not DOM selectors or completeness proofs. OpenAI Decisions was verified as a separate API, but was not added or benchmarked; Luna here is the Responses baseline through the existing gateway.

## Final confirmation

The final capture used Sauce Demo, Selenium's web form and GlobalsQA's banking demo. These domains were unused in observe development; Selenium had already appeared in act experiments. All instructions, DOM identities, acceptable methods and literal arguments were reviewed against the captured trees before inference. No grader or policy changes followed this batch.

Sauce Demo exposes exactly the requested Username/Password pair and Login button. Selenium supplies the explicitly named Text input/Password pair plus a native file control. GlobalsQA supplies the explicitly named Customer/Bank Manager Login pair. Three negative requests ask for an absent refund button. This final set contains no no-instruction task, so the median win does not depend on zero-model discovery.

### Frozen replay, final source

Eleven tasks, two interleaved rounds per arm. All arms receive identical captured evidence. Historical observer source is pinned to `9080038614bcaf5ee32afad44970f282ad0c73bd`.

| Arm                                | Passed | Wrong direct results | Direct / fallback |        p50 / p95 |
| ---------------------------------- | -----: | -------------------: | ----------------: | ---------------: |
| Historical Decider observer + Luna |  22/22 |                    0 |            16 / 6 | 1,096 / 3,942 ms |
| New Decider observer + Luna        |  22/22 |                    0 |            20 / 2 |   586 / 2,293 ms |
| Ordinary Luna                      |  22/22 |                    — |                 — | 1,416 / 2,621 ms |

Archive: `runs/observe/confirmation3-replay-1/`. Capture: `confirmation3-capture-3/`.

### Public SDK, default Decider

A separately scheduled live round on the same 11 tasks. Navigation and benchmark readiness are outside the observation timer. SDK timing includes capture, evidence building, decisions, the second evidence check and any fallback. Returned selectors are checked against actual DOM identities; literal-fill proposals are executed through `stagehand.act()` and read back.

| Arm                                | Passed | Wrong direct results | Direct / fallback |    SDK p50 / p95 |
| ---------------------------------- | -----: | -------------------: | ----------------: | ---------------: |
| Historical Decider observer + Luna |  11/11 |                    0 |             8 / 3 | 1,673 / 4,251 ms |
| New Decider observer + Luna        |  11/11 |                    0 |            10 / 1 |   588 / 2,902 ms |
| Ordinary Luna                      |  11/11 |                    — |                 — | 1,570 / 2,881 ms |

New Decider's median is 63% lower than Luna's and 65% lower than the historical observer's. Its measured tail is effectively flat against Luna, 21 ms slower; eleven samples make p95 the maximum. Do not claim a default-model tail improvement from this round. All six observe-then-act fills passed across the three arms.

Archive: `runs/observe/confirmation3-default-live-1/`.

### Public SDK, explicit Flash follow-up

Policy, thresholds and frozen task definitions remain fixed; only the decision model changes. Two rounds per arm, with a new rotated Luna control. This is a provider/model follow-up on an already captured set, not another independent held-out.

| Arm                       | Passed | Wrong direct results | Direct / fallback |    SDK p50 / p95 |
| ------------------------- | -----: | -------------------: | ----------------: | ---------------: |
| New Flash observer + Luna |  22/22 |                    0 |            20 / 2 |   437 / 1,965 ms |
| Ordinary Luna, paired     |  22/22 |                    — |                 — | 1,426 / 2,233 ms |

Fourteen of sixteen positive runs completed directly, as did all six negative cases with correct empty results. Both escalations were complete-set requests on Selenium. All eight observe-then-act fills passed. Percentiles use nearest rank; 22 samples make p95 the second-largest observed value. Repeated rounds measure consistency, not independent pages.

Archive: `runs/observe/confirmation3-flash-live-1/`.

## Earlier batches and counterexamples

Do not pool timings across these separately scheduled sessions or present them as one untouched holdout.

| Comparison                                        | New result                                      | Paired controls                                               | Interpretation                                                        |
| ------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| Development replay, 14 tasks twice                | 28/28, zero wrong direct results, two fallbacks | Old observer 22/28 with six wrong direct results; Luna 28/28  | Development evidence after versioned grader corrections               |
| First confirmation replay, 13 tasks twice         | 26/26, zero wrong direct results, two fallbacks | Old observer 22/26 with four wrong direct results; Luna 26/26 | Before the later file-control correction                              |
| First confirmation live, default Decider          | 26/26 at 1,833 / 5,986 ms                       | Luna 26/26 at 1,758 / 18,766 ms; old observer 22/26           | Default Decider was slightly slower at the median in this session     |
| First confirmation live, Flash                    | 26/26 at 881 / 5,349 ms                         | Luna 26/26 at 1,798 / 20,477 ms                               | Supports a median and tail gain on this batch                         |
| Second confirmation replay, corrected labels      | 20/20, zero wrong direct results, two fallbacks | Old observer 18/20 with two wrong direct results; Luna 20/20  | Original gold selector omitted the State input; all arms rescored     |
| Second confirmation live, Flash, corrected labels | 20/20 at 448 / 5,213 ms                         | Luna 20/20 at 1,744 / 5,089 ms                                | Median improved, tail worsened by 124 ms; not a universal latency win |

First confirmation domains were Scrapeme, EvilTester and WebdriverUniversity. Second confirmation domains were LambdaTest, Applitools and The Internet. The third confirmation was captured after the file-control fix and after independently reviewing the new targets.

Archives, in table order: `dev-runtime-1/`, `confirmation-replay-1/`, `confirmation-live-2/`, `confirmation-flash-live-1/`, `confirmation2-replay-v2/`, `confirmation2-flash-live-v2/`. Versioned labels are `dev-labels-v2/`, `confirmation-capture-3/` and `confirmation2-labels-v2/`.

### Rejected variants

- The first eager pack scored correctly after fallback but sent large competing candidate packs through every question. Local question evidence reduced unnecessary shared context.
- Serial routing reduced tokens but did not improve overall development latency. It retained two sequential model stages.
- Child-role, visible-text and link-content annotations did not eliminate the uncertain book-title group. Keep the counterexamples and fallback.
- Structural group selection did not help the targeted ten-run comparison. Its median was 1,449 ms versus 714 ms for local predicates, and its p95 was 10,318 ms versus 8,922 ms. Both passed 10/10 with two fallbacks.
- A single-choice-only gate and companion existence gate tied on the development outcomes. That does not prove the extra predicate useless on unseen absence cases; the retained policy keeps it.

These experiments mix end-to-end policy comparisons with narrower representation/gate ablations. They do not establish that each individual implementation change caused the entire product improvement. The prototype variants remain only in the research runner.

Archives: `dev-policy-1/`, `dev-policy-v2/`, `dev-local-1/`, `dev-routed-1/`, `dev-grouped-1/`, `dev-visible-text-1/`, `dev-content-1/`.

## Controlled compatibility and mutations

`controls-3/` passed **25/25** checks across new observe and ordinary Luna, including a decision-key-only configuration. It covers scope and ignored locators, iframe/shadow selection through fallback, native select and press proposals, hover, double click, file upload location, headings, readonly fields, variables and custom system instructions. A missing ordinary model fails clearly only when fallback is needed.

`mutations-1/` ran replacement, same-node relabeling and addition of a matching field, twice per arm. All eighteen mutations occurred before observation returned.

| Arm                  | Correct observations after controlled mutation |
| -------------------- | ---------------------------------------------: |
| New Decider observer |                                            6/6 |
| Historical observer  |                                            0/6 |
| Ordinary Luna        |                                            0/6 |

For replacement/relabeling, stale returned actions were executed only on harmless local HTML to expose the deliberately wrong effect. For set addition, the grader required both fields. These are controlled regression mechanisms, not untouched public-site accuracy. Observation cannot protect against a new mutation after it returns; callers still use the normal action executor.

## Provider checks

On the first confirmation snapshots, one additional fixed-policy replay per task completed 13/13 for Jev and 13/13 for Clef, with zero wrong direct results. Jev accepted ten directly and escalated three; Clef accepted seven and escalated six. These are transport/coverage probes on seen data, not proof of equal calibration or a provider ranking. Archives: `provider-jev-1/`, `provider-clef-1/`.

The public surface remains provider credentials plus optional model/endpoint/account metadata. No observe policy flags were added. Hosted Clef Flash has a conservative byte budget because its documented 24k context can truncate evidence; oversized input escalates before the request. That specific budget has a unit regression, not a new Clef Flash quality benchmark.

## Evidence corrections and excluded runs

- Development grader v1 required fill/type for a locate-only field request and demanded one of two equivalent product-detail links. Corrections permit click/focus and verified equivalent destinations. Linked-image activation is normalized without allowing duplicate selectors. Original runs remain; every arm was rescored in a new directory.
- The second confirmation's `input[name]` gold selector omitted the visible State input, which lacks a name attribute. Its original snapshot and each live DOM identity diagnostic prove that it belongs to the unchanged all-text-entry-fields instruction. `confirmation2-labels-v2/`, `confirmation2-replay-v2/` and `confirmation2-flash-live-v2/` correct every arm without new inference. The final third batch has no such post-scoring correction.
- `confirmation-live-1/` is excluded. It exposed fractional `inferenceTimeMs` rejected by the wire schema and an undefined optional grader argument. The metadata is now integral, and a regression validates the full result schema. Diagnostic console output was scrubbed of configured credentials.
- `controls-1/` is excluded because its grader called an SDK locator method that does not exist. `controls-2/` found the real native-file false-empty bug. `controls-3/` reran the complete matrix after the production fix.
- MDN's input reference produced large embedded-frame trees, including recursive live examples. Its original captures remain outside the small scored batch. No truncated subset is counted as a correct complete observation.
- The first final-batch preparation hit an empty HTTP page and then a certificate failure at UI Testing Playground. That site was replaced before inference. GlobalsQA required a readiness wait. These attempts remain in `confirmation3-capture-1/` and `confirmation3-capture-2/`; only `confirmation3-capture-3/` was scored.

## Runtime modules and validation

`observeCandidates.ts` owns native/AX candidate evidence, normalized selector accounting and signatures. `observeSelection.ts` owns bounded typed questions, uncertainty handling, grounded literal proposals and variable redaction. `observe.ts` owns browser captures, shared deadlines/cancellation and evidence revalidation. `observeService.ts` retains ordinary inference, normalization and caching, aggregates decision/fallback usage, and stores no negative cache result. The controller routes only the experimental namespace through the decision path.

The observer no longer imports the old action orchestrator, best/strict picker, page-state or tool-routing modules. They are removed with the observer replacement. All historical Markdown and raw evidence remain.

Validation passed: 2,612 unit/reference/parity tests, 1,115 Python tests, 46 browser/package tests, extension/SDK/protocol TypeScript checks, a dedicated observe-script typecheck, schema/Python generation consistency, scoped lint/format checks, and extension/SDK builds. The SDK's packaged extension was verified against the current service-worker bundle. The published cross-version network test was excluded. Generated Python remains under its generator and is excluded by the package's normal Ruff configuration.

This work supports bounded experimental observe with ordinary fallback. It does not establish complete native feature parity, universal set completeness, production release readiness or a general cost reduction. On several batches the decision questions used more input tokens than ordinary Luna. Remote Browserbase cache behavior and all twelve existing public observe evals were not newly measured live; their unit coverage remains. More domains, visual-only controls, dense-page retrieval and provider-specific calibration remain useful follow-ups.

## Reproduce

Raw data is under [`vendor-repos/system-one-corpus/runs/observe/`](../../../../../vendor-repos/system-one-corpus/runs/observe/). The compact [result manifest](../results/observe-2026-11-16.json) records per-run result/manifest hashes. The [final source manifest](../../../../../vendor-repos/system-one-corpus/runs/observe/final-source-20261116/manifest.json) identifies the complete source archive, bundle and validation logs. Frozen replay includes exact provider request bodies/responses; live runs retain source and bundle hashes, before captures, returned actions, usage and DOM identity diagnostics. Live provider wire responses are not independently intercepted.

```sh
node --import tsx packages/sdk-ts/scripts/system-one/prepareBaseline.ts
node_modules/.bin/vite build --config vendor-repos/system-one-corpus/runs/cleanup/2026-11-15/baseline/packages/extension/vite.config.ts
node_modules/.bin/vite build --config packages/extension/vite.config.ts

OBSERVE_ARMS=runtime,legacy,luna OBSERVE_ROUNDS=2 node --env-file=.env --import tsx \
  packages/sdk-ts/scripts/system-one/observe/replay.ts \
  vendor-repos/system-one-corpus/runs/observe/confirmation3-capture-3 \
  vendor-repos/system-one-corpus/runs/observe/new-replay-run

OBSERVE_ARMS=runtime,luna OBSERVE_MODEL=pplx-decider-flash-v1.3 OBSERVE_ROUNDS=2 \
  node --env-file=.env --import tsx packages/sdk-ts/scripts/system-one/observe/live.ts \
  vendor-repos/system-one-corpus/runs/observe/confirmation3-capture-3 \
  vendor-repos/system-one-corpus/runs/observe/new-live-run

node_modules/.bin/tsc --noEmit -p packages/sdk-ts/scripts/system-one/observe/tsconfig.json
```

Use new output directories. To reproduce a historical candidate, restore the archived source and its recorded bundle rather than rerunning today's source and assigning it yesterday's label. Keep failed captures, original graders and original results alongside corrected versions.
