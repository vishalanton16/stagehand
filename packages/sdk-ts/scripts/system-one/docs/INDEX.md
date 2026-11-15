# System One docs

Status and handoff for experimental System One extraction (`extract: "map"`). The runtime uses one decision model with an LLM fallback.

| Doc                                                | Purpose                                                                      |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| [REVIEW.md](./REVIEW.md)                           | Review of the **uncommitted** production wiring on top of commit `632789220` |
| [NEXT_STEPS.md](./NEXT_STEPS.md)                   | Ordered engineering tasks with done conditions                               |
| [EVALUATION.md](./EVALUATION.md)                   | How to measure fairly (held-outs, metrics, what not to claim)                |
| [ARCHITECTURE.md](./ARCHITECTURE.md)               | How the pipeline works and where the code lives                              |
| [ROADMAP.md](./ROADMAP.md)                         | Product phases from experiment → default                                     |
| [DIRECTIONS.md](./DIRECTIONS.md)                   | Alternatives and experiments that are deliberately _not_ the product default |
| [PROVIDER_RESEARCH.md](./PROVIDER_RESEARCH.md)     | Provider research and the next evidence-ranking experiment                   |
| [DECISION_PRIMITIVES.md](./DECISION_PRIMITIVES.md) | Provider contracts, abstention experiments, and scalar span results          |

Also read:

- [`../README.md`](../README.md) — how to configure and reproduce
- Root [`AGENTS.md`](../../../../../AGENTS.md) — stacked PR rules for this repo

## Plan status

| Step                                  | Status  | Observation or remaining work                                                                                                                                                                                        |
| ------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Seen-set regression                | Done    | Ran 49 pages twice. Decider held at 96/98. Both runtime versions accepted the same incomplete MDN list.                                                                                                              |
| 2. Remove the production verifier     | Done    | Production uses structural checks. Replay retains the optional model verifier. The combined changes cut mean completed decision requests from 3.18 to 2.19.                                                          |
| 3. Reduce sequential calls            | Partial | Scalar Locate now runs alongside fact selection. List batching and skipping the row check were tested together and rolled back after wrong accepts rose from 2 to 6.                                                 |
| 4. Isolate the user instruction       | Done    | The mapper receives the user instruction alone. A regression test checks that a numbered system prompt stays out of the mapper input.                                                                                |
| 5. Clean up traces                    | Done    | Info logs include routing, reasons, and the request count. Debug logs carry the full trace. Missing rows are counted per field.                                                                                      |
| 6. Choose cross-check strictness      | Partial | Retained normalized exact comparison for scalars and strict validation of required list fields. Locate returned day fragments for Eiffel Tower dates. A controlled exact-versus-containment comparison remains open. |
| 7. Run fresh heldout 5                | Done    | Six new sites, two rounds each. Decider and Flash each scored 10/12. Both misses per model came from the same ambiguous temperature page.                                                                            |
| 8. Measure real pages through the SDK | Done    | Three sites, two rounds each. Decider passed 6/6 with zero fallbacks, and Luna passed 4/6. Decider had higher p50 and p95 latency.                                                                                   |
| 9. Prepare a reviewable stack         | Pending | The initial implementation is in one local commit, `a9e5b9484`. The follow-up changes are unstaged. The suggested PR split is in [NEXT_STEPS.md](./NEXT_STEPS.md#9-split-into-a-reviewable-stack).                   |

## Measurements

| Comparison                  | Result                                                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seen replay, before → after | Passes 96/98 → 96/98, correct direct accepts 78 → 77, fallbacks 18 → 19, wrong accepts 2 → 2. Replay p95 14.52 s → 11.32 s.                                           |
| Fresh replay                | Decider 10/12 with 4 fallbacks, Flash 10/12 with 6 fallbacks, Luna 8/12 with standard instructions and 10/12 in a separately scheduled run with absence instructions. |
| Live SDK                    | Decider 6/6 at 6.02 s p50 and 10.86 s p95. Luna 4/6 at 3.95 s p50 and 4.48 s p95. Both timings include navigation and snapshot capture.                               |

The MDN task returned 38 of 63 requested status codes and passed the runtime checks both times. The NIST grader required 273.15 K from the prose, and both decision models returned 273 K from the table. The frozen scores preserve that ambiguity. On the real-page subset, Luna returned an empty string for an absent DOI in both RFC runs. The IANA task drove the upper latency tail in fresh replay. [Full results and replay archive IDs](../README.md#plan-validation)

`extract: "map"` remains opt-in. The open release gates are list completeness, fewer round trips without added wrong accepts, a controlled comparison of the scalar checks, and an independent confirmation on another fresh set. The saved runs and detailed comparisons are linked from the [README](../README.md#plan-validation).

### List completeness follow-up

| Targeted replay                                                             | Before                  | After                                         |
| --------------------------------------------------------------------------- | ----------------------- | --------------------------------------------- |
| MDN status codes                                                            | 38 of 63 in both rounds | All 63 codes in snapshot order in both rounds |
| MDN frozen grader                                                           | 0/2, incomplete list    | 0/2, copied the code into the name field      |
| Craigslist, separate tables, Python documentation links, and mountain names |                         | 8/8, all accepted directly                    |

Description-list terms now group across sibling regions with the same parent even when their label markup differs. The mapper still needs to distinguish a name from the number in a composite label. The targeted replay is archived under `runs/archive/d6f9c44b-c34a-4d99-ab32-62496be6b90f/`. A full seen-set rerun remains pending for this change.

The composite-label follow-up gives the mapper both the whole label and the trailing text when a list schema asks for numeric and text fields. Decider passed both MDN runs with all 63 codes and separate names. Both runs used two decision requests and no fallback. All eight related targeted runs passed.

| Seen replay   | Before either follow-up | After both follow-ups |
| ------------- | ----------------------: | --------------------: |
| Passed        |                   96/98 |                 98/98 |
| Wrong accepts |                       2 |                     0 |
| Fallbacks     |                      19 |                    19 |
| p50 latency   |                  4.15 s |                4.14 s |
| p95 latency   |                 11.32 s |               14.75 s |

The rerun used a separate provider session with concurrency 7 versus 6 for the baseline, so the p95 difference cannot be attributed to the code alone. The replay is archived under `runs/archive/fddc6f3f-cab7-40ed-a852-5df496fefd78/`. The seen set informed the fixes.

### Heldout 6 and follow-up experiments

Four usable site-disjoint snapshots covered scalar facts, optional evidence, a table, and a manual with paragraph-form lists. Wikibooks returned a missing page, MTU returned an error page, and the Sonic Pi snapshot lacked explicit evidence for the requested creator. The four scored graders were frozen before model calls.

| Replay arm     | Passed | Direct accepts | Wrong accepts | Fallbacks | p50 / p95      |
| -------------- | -----: | -------------: | ------------: | --------: | -------------- |
| Decider + Luna |    6/8 |              6 |             2 |         2 | 5.50 / 10.44 s |
| Flash + Luna   |    8/8 |              4 |             0 |         4 | 3.50 / 7.41 s  |
| Luna           |    7/8 |              — |             — |         — | 5.03 / 6.62 s  |

Both decision models fell back on curl's protocol list. Decider twice used the number in a textbook title as evidence for an optional edition. Luna made the same inference once. The baseline is archived under `runs/archive/b3acb4f6-8d3c-4192-84e7-412703e3fbcd/`.

- Heading-scoped grouping now builds a candidate from alternating short labels and descriptive paragraphs. A matching heading earns a place in the candidate shortlist even on long pages. Decider and Flash both extracted all 16 curl protocols directly in both targeted rounds.
- Optional scalar questions now include an explicit-evidence check in the existing choice request. Decider omitted the inferred edition in both targeted rounds. Flash disagreed with its Locate reading for the title and fell back twice. One fallback still inferred an edition.
- A separate nginx check exposed an independent coverage failure. Decider selected the right table and then dropped WINCH during filtering, since the same signal appeared in another table. The subset and row questions now name the selected group as their scope. Both Decider nginx reruns passed directly.
- The curl, textbook, and nginx reruns are regression evidence. Their results are archived under `runs/archive/de9b6a51-5653-436a-9b89-063b4dd1b822/` and `runs/archive/9a9b6a36-db86-49ad-a719-6a8c9cd3d80d/`.

The scoped-filter version passed **98/98** seen replays with **80** direct accepts, **18** fallbacks, and **zero** wrong accepts. Replay p50/p95 was 4.67/14.78 s. That run is archived under `runs/archive/e312cf85-675f-45bd-9d30-800ef8bf7d6e/`.

Both arms passed the live public SDK smoke check on nginx and curl. Decider accepted both directly. End-to-end times were 7.13/8.59 s for Decider and 5.00/5.92 s for Luna, in nginx/curl order. See `runs/plan-validation/stagehand-held6-live.jsonl`. The separate first nginx comparison is preserved under `runs/archive/a283132a-fda1-4156-9c6b-1cca3a633ee8/`. GNU Make was excluded from that check after navigation timed out.

### Overlap list group selection with field mapping

Commit `a14844c46` contains the coverage, optional-evidence, and group-scope fixes. The new replay arm `runtime-decider-speculative` starts field and scope mapping for the top-ranked candidate while the existing decision call selects the group. It uses the early response only when selection chooses that same group. Group agreement, field validation, and fallback still apply. The public SDK uses the sequential path.

| Eight list pages, two rounds | Passed | Wrong accepts |    p50 |     p95 | Mean calls | Mean input tokens |
| ---------------------------- | -----: | ------------: | -----: | ------: | ---------: | ----------------: |
| Sequential Decider           |  16/16 |             0 | 4.59 s | 10.97 s |       2.25 |             3,312 |
| Speculative Decider          |  16/16 |             0 | 3.23 s |  6.99 s |       2.88 |             4,024 |
| Luna                         |  15/16 |             — | 5.64 s |  9.76 s |       2.00 |            37,693 |

All Decider runs answered directly. Early work matched the selected group in six runs, with 19 ms median wait remaining after selection. Ten runs mapped another group. The sample comprises regression pages and measures frozen replay. See `runs/archive/1fdebce5-3df6-40a5-8295-2a309097b140/`.

| Full seen replay                               | Sequential | Speculative |
| ---------------------------------------------- | ---------: | ----------: |
| Passed                                         |      98/98 |       98/98 |
| Wrong accepts                                  |          0 |           0 |
| Fallbacks                                      |         20 |          19 |
| p50 latency                                    |     4.58 s |      3.54 s |
| p95 latency                                    |    12.56 s |     12.53 s |
| Mean completed model calls, including fallback |       2.59 |        2.71 |
| Mean input tokens                              |      9,963 |      10,239 |

On the 56 list runs per arm, p50 fell from 5.18 s to 3.65 s. Both arms used fallback eight times, and 44 of 56 early mappings matched the selected group. This replay supports a median latency improvement. The full-set tail was effectively flat and the smaller list sample needed more extra requests. Keep the optimization replay-only until a paired live check measures tail latency and the overhead of guessing the wrong group. Full replay archive: `runs/archive/da23a4cb-e8b4-420d-8c18-69d892ea1aed/`.

### One request for group and field selection

A replay experiment included the group questions and field mappings for the two highest-ranked groups in one request. The existing group check still decided which answers to use. A separate variant moved repeated record previews into shared request state.

| Eight list pages, two rounds | Passed | Wrong accepts |    p50 |     p95 | Mean calls | Mean input tokens |
| ---------------------------- | -----: | ------------: | -----: | ------: | ---------: | ----------------: |
| Sequential Decider           |  16/16 |             0 | 1.00 s |  2.99 s |       2.25 |             3,312 |
| Bundled Decider              |  16/16 |             0 | 1.76 s |  2.72 s |       1.88 |             7,944 |
| Sequential Flash             |  14/16 |             2 | 0.86 s |  8.02 s |       2.50 |             3,951 |
| Bundled Flash                |  14/16 |             2 | 0.95 s |  8.41 s |       2.12 |             8,583 |
| Luna                         |  16/16 |             — | 5.37 s | 10.85 s |       2.00 |            37,690 |

The selected group was among the two bundled candidates in six of 16 runs per decision model. The larger first request and the remaining sequential requests erased the expected median latency gain. The shared-preview variant scored 14/16 against 16/16 for its sequential Decider control, with two Everest alias wrong accepts. Both bundling variants were removed from the working implementation. Their code and results are preserved in replay archives `09c4bc8c-877c-4aa7-98a6-53ea34bffa54` and `3ffbb83a-ffcb-4901-b9c9-45e6dd1d7d7a`.

### Live latency with rotated model order

The live runner now rotates model order each round. Five real pages ran three times per arm, including the curl manual, nginx tables, Rust types, Mars figures, and the textbook title. These pages were already used in development.

| Public SDK arm     | Passed | Fallbacks | Extract p50 / p95 | End-to-end p50 / p95 | Mean input tokens |
| ------------------ | -----: | --------: | ----------------- | -------------------- | ----------------: |
| Sequential Decider |  15/15 |         0 | 1.02 / 2.93 s     | 1.43 / 3.12 s        |             3,283 |
| Sequential Flash   |  15/15 |         3 | 0.75 / 6.57 s     | 1.39 / 7.70 s        |             5,508 |
| Luna               |  15/15 |         — | 4.50 / 5.98 s     | 5.02 / 8.57 s        |            37,316 |

The earlier three-page live check had end-to-end p95 of 10.86 s for Decider and 4.48 s for Luna. The new run used a different page subset and provider session. It confirms Decider can beat Luna on these five pages and leaves cross-session tail latency open. Fifteen samples per arm make nearest-rank p95 the maximum observed time. All three Flash fallbacks came from the textbook title's scalar disagreement. Results are in `runs/plan-validation/stagehand-rotated-live.jsonl`.

### Candidate ranking and source mapping

The schema-aware ranker improved offline evidence retrieval, but increased fallback in the paired replay. Keep it in the replay harness. The single-request fit check also increased latency and was removed. The source-mapping changes from the oracle experiment are in the SDK path. PostgreSQL's nested chapter now passes directly on frozen replay. See [audit and trial results](./PROVIDER_RESEARCH.md#evidence-ranking-and-one-request-trials).

### Decision primitives and evidence recovery

| Experiment               | Result                                                                                                                    | Status                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Six-provider group probe | Jev 1.14.0 served the pinned requests. With the correct groups removed, models abstained on 1–6 of 12 tasks.              | Preserve explicit abstention and test it independently.   |
| Single choice            | Passed 70/70 regression runs. On five fresh pages it wrongly accepted both GitHub qualifier runs.                         | Archived.                                                 |
| Retry after abstention   | Recovered all four Kubernetes and WebAssembly runs. Targeted median fell from 4.64 s to 2.35 s with effectively flat p95. | Replay only pending the fresh live comparison.            |
| Bounded scalar readers   | Clairic 8/8, both Locate models 7/8 on exact copy. Every returned text offset matched.                                    | Test real-page scalar provenance and typed normalization. |
| List copy                | Preserves unspaced colons in values. GitHub's inline whitespace issue remains in the snapshot.                            | Covered by a regression test.                             |

See [provider sources, results, and archive IDs](./DECISION_PRIMITIVES.md).

The first [missing-evidence probe](./DECISION_PRIMITIVES.md#missing-evidence-check) found four wrong initial group picks and two more after retry across 30 negative runs. Field mapping caught both retry errors. Both Python docs errors passed runtime validation as incomplete lists. The retry recovered all four positive controls. The roadmap now calls for a source-coverage check before live promotion.

The [source-coverage follow-up](./DECISION_PRIMITIVES.md#source-coverage-check) removed both incomplete Python results from the direct path. It preserved all four retry-only controls in the full probe. Both arms passed the 37-task paired replay with four fallbacks each. The coverage check remains a replay arm pending a fresh live comparison.

### Live retry and source coverage

The [live SDK comparison](./DECISION_PRIMITIVES.md#live-sdk-comparison) ran seven URLs three times per arm. Retry and source coverage reduced fallbacks from 12/21 to 7/21 and extraction p50 from 4.69 s to 1.63 s. Extraction p95 was 6.18 s versus 6.03 s for the current path and 7.72 s for Luna. Both Decision arms scored 18/21 because section filtering dropped one W3C landmark in every run. Luna scored 21/21. Keep the candidate experimental and address row coverage next.

### Nested heading row fix

The data view now keeps a list under its own heading when a preceding sibling has a different heading. W3C went from 0/2 to 2/2 live, with all eight rows. Both Decision arms went from 41/42 to 42/42 on frozen replay. In a separate four-page live follow-up, each arm passed 8/8 and the retry candidate used no fallback. All four successful retries came from known controls. [Row coverage results](./DECISION_PRIMITIVES.md#row-coverage-after-nested-headings)

### SDK pattern decision

Keep the current Decider and Luna fallback pattern with the nested-heading fix. In the [five-page fresh promotion check](./DECISION_PRIMITIVES.md#fresh-retry-promotion-check), each Decision arm scored 9/15 with the same nine fallbacks. The candidate never retried or rejected a competing source. The next experiment is exact span copying, led by SQLite function names and the GitHub qualifier regression.
