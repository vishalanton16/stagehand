# Decision primitives and extraction evidence

## What the providers expose

| Provider              | Contract and implication for Stagehand                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeSafe Jev          | `jev-1.14.0` is the current stable release and the target of `jev-latest`. Default limits are 64k per request and 32k per question. Jev evaluates independent questions against shared state. TypeSafe's hierarchy cookbook compares a greedy tree walk with a beam that preserves close alternatives. Its composite-scoring and autoresearch recipes keep partial judgments available to downstream code. For extraction, retrieve blocks with a few complementary signals and evaluate the value of each signal against labeled pages. The new Box output localizes images and was outside this text experiment. [Release](https://typesafe.ai/blog/jev-1-14) · [Models](https://docs.typesafe.ai/models) · [State](https://docs.typesafe.ai/concepts/state) · [Hierarchical classification](https://docs.typesafe.ai/cookbooks/hierarchical_classification) · [Composite scoring](https://docs.typesafe.ai/patterns/composite-scoring) · [Feature discovery](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery) |
| OpenAI Luna Decisions | Predicates assess a claim. Choice answers carry an option distribution and a separate confidence field. The generally available API takes up to 400 questions and supports JSON input and cache reads/writes. Shared input needs at least 1,024 tokens for prefix reuse. The probe used AI Gateway's OpenAI-compatible route with `openai/gpt-6-luna-decisions`; the generation fallback used Luna Responses. The guide and worked examples place exact checks in code and route uncertainty based on labeled cases. [Guide](https://developers.openai.com/api/docs/guides/decisions) · [Launch](https://openai.com/index/decisions-api/) · [Gateway route](https://vercel.com/changelog/openai-decisions-api-now-available-on-ai-gateway) · [Worked examples](https://vercel.com/i/openai-decisions-api-use-cases)                                                                                                                                                                                                                |
| Cloudflare Clef       | Clef's options route evidence before scoring, with attention across fields. Field predictions can interact, so packing is an experimental variable. Current list prices are $0.24/M input tokens for Clef and $0.038/M for Clef Flash. Historical `clef` replay arms used Flash. [Architecture](https://blog.cloudflare.com/clef-decision-models/) · [Clef](https://developers.cloudflare.com/workers-ai/models/clef/) · [Clef Flash](https://developers.cloudflare.com/workers-ai/models/clef-flash/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Cloudflare Clairic    | Text answers can carry spans. Scalar `value` represents the answer, while `guess` and span metadata may still exist when that answer is null. Typed numbers can be computed and need extra evidence if the contract requires a printed value. Each text field normally uses a separate pass, which bills the evidence again. The published extraction example operates on a bounded source and a handful of fields. [Model and billing](https://developers.cloudflare.com/workers-ai/models/clairic/) · [Extraction concepts](https://developers.cloudflare.com/workers-ai/concepts/extraction-models/) · [Research and examples](https://blog.cloudflare.com/clairic-extraction-model/)                                                                                                                                                                                                                                                                                                                                           |
| Perplexity Decider    | Both v1.3 variants support Locate. Its head can return several verbatim spans or an empty list. It was trained up to 8K input tokens and evaluated up to 32K for this feature, below the endpoint's supported maximum. v1.3 choice questions are largely isolated, with some interaction through shared state. A provider-side split repeats the evidence and runs the groups in sequence. [API](https://docs.perplexity.ai/docs/decisions/quickstart) · [Training and evaluation](https://www.perplexity.ai/en-GB/hub/blog/perplexity-decider)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

The independent [multiple-correct-choice study](https://arxiv.org/abs/2610.29217) found uneven probability allocation even among identical options and poor threshold-based recovery of multiple positives. Its datasets differ from ours. It gives a reason to test selection, abstention, and row inclusion separately.

## Assumptions tested

- The current gate requires the relative-choice winner to match the candidate with the highest independent predicate score. A single plausible source can satisfy both. With several usable sources, the two rankings can differ. The questions share the same model and evidence, so their agreement is a correlated check.
- A shortlist may have zero valid sources. An explicit abstention option gives the model somewhere to put that answer. It still needs to recognize when none of the available evidence covers the request.
- A grounded span can have the wrong boundary, unit, record, or scope. Evaluate exact copy and typed normalization separately. Keep source positions through normalization and check them in the original string.
- A lower number of questions can cut tokens without cutting round trips. Direct-path timing and fallback timing need separate reporting.

## Group-selection probes

Six models received the same semantic questions on 12 previously used snapshots. Native wire formats and gateway serialization differ. We use one preferred group from the audit and count any group that covers the labeled boundaries separately. Coverage is measured before row filtering. In the removal arm, all covering groups were removed. These are deliberately hard negatives and their results measure abstention, not completed extraction.

| Model                         | Plain choice picked preferred | Rich choice picked a covering group | Abstained after removal | Mean input tokens, dual → plain |
| ----------------------------- | ----------------------------: | ----------------------------------: | ----------------------: | ------------------------------: |
| Jev 1.14.0                    |                         12/12 |                               12/12 |                    5/12 |                     1,744 → 908 |
| Luna Decisions via AI Gateway |                         10/12 |                               12/12 |                    4/12 |                     2,502 → 626 |
| Clef                          |                          8/12 |                               12/12 |                    2/12 |                     2,146 → 745 |
| Clef Flash                    |                          9/12 |                               12/12 |                    1/12 |                     2,146 → 745 |
| Decider v1.3                  |                         12/12 |                               12/12 |                    6/12 |                     1,546 → 625 |
| Decider Flash v1.3            |                         12/12 |                               12/12 |                    3/12 |                     1,546 → 625 |

Rich choice included bounded source labels and column headers. The option IDs and candidate set stayed fixed. Luna changed one answer after the real candidates were reversed. No other completed pair changed, and one Flash reversal returned HTTP 429. When the covering groups were absent, Luna assigned confidence of 0.89 to a wrong group. Flash reached 0.845. The probabilities and confidence fields use provider-specific semantics. These results argue against relying on a universal threshold.

The Jev response confirmed `jev-1.14.0`. On its fully populated shortlist, the current dual rule accepted 8/12 even though the choice identified the preferred group 12/12 times. Checking only the selected group's predicate accepted 10/12. Broader replay and fresh pages below test how much of that gain survives field mapping.

Archives under `runs/group-probes/`: native `2cb79dde-fe38-4500-ab4f-e42db87a6953`, AI Gateway `b660c2e0-8f7d-40d2-af96-f7daece67930`. The archives include semantic request packs, snapshot hashes, provider-reported usage, and raw scores.

## Bounded scalar readers

Eight short fixtures cover pricing cadence, absent edition, explicit zero, neighboring records, inverse units, multiple fields, Unicode offsets, and a value that could be computed but is absent. Each provider received identical source strings and field instructions. Locate used its highest-scoring span. Clairic used its returned value. The typed arm used number fields where applicable, with no numeric-span guarantee.

| Reader                    | Exact fixtures | Mean billed input tokens |
| ------------------------- | -------------: | -----------------------: |
| Decider v1.3 Locate       |            7/8 |                       97 |
| Decider Flash v1.3 Locate |            7/8 |                       97 |
| Clairic text              |            8/8 |                      212 |
| Clairic typed             |            8/8 |                      198 |

Both Locate models returned `USD 39` for a request for `39`. They chose the correct billing cadence. All returned text offsets matched their values when indexed by Unicode code point, including evidence after an emoji. Clairic correctly returned null for the unprinted total while its guess pointed at `12 USD`. Two numeric fields shared one pass and billed 179 tokens, versus two text passes and 293 tokens on the same fixture. Three text fields used three passes and billed 437 tokens. This isolates the reason a short request can still bill repeated evidence.

These fixtures establish the distinction between span selection, normalization, and absence. They leave real-page scalar fallback behavior open. Archive under `runs/scalar-probes/dea78160-b105-4776-98b6-6c5fc3be7471/`. An earlier concurrent pilot encountered two HTTP 429s. The reported run was sequential and completed all 32 requests.

## End-to-end extraction replay

| 35 regression snapshots, two rounds | Passed | Wrong accepts | Fallbacks |      p50 / p95 | Mean input tokens | Est. USD / 1k |
| ----------------------------------- | -----: | ------------: | --------: | -------------: | ----------------: | ------------: |
| Current dual gate                   |  70/70 |             0 |         8 |  1.05 / 9.92 s |             6,411 |        $0.206 |
| Single choice                       |  70/70 |             0 |         6 | 1.06 / 11.44 s |             5,669 |        $0.187 |
| Choice plus selected predicate      |  70/70 |             0 |         6 | 1.17 / 11.03 s |             6,516 |        $0.204 |

The reduced gates recovered two direct answers on Web Scraper's product task. The two country-table fallbacks took about 57–60 seconds across arms and dominated the far tail. Archive: `e9b7561e-4b5b-4bb1-8a8f-228c822e006a`.

Five newly captured pages from existing and new domains ran twice under a frozen grader. The set measures new pages. Some sites already appeared in the corpus.

| Fresh pages                    | Passed | Wrong accepts | Fallbacks |      p50 / p95 |
| ------------------------------ | -----: | ------------: | --------: | -------------: |
| Current dual gate              |   8/10 |             0 |         6 | 4.62 / 10.27 s |
| Single choice                  |   8/10 |             2 |         4 |  1.04 / 5.74 s |
| Rich single choice             |   8/10 |             2 |         4 |  1.14 / 5.83 s |
| Choice plus selected predicate |   8/10 |             0 |         6 | 4.64 / 10.14 s |
| Luna                           |   8/10 |             — |         — | 3.90 / 12.13 s |

Single choice returned GitHub qualifier suffixes without their prefixes. The dual gate escalated, and Luna retained the prefixes but preserved a space inserted after the slash in the accessibility snapshot. The frozen grader expects the contiguous qualifier. Both are genuine failures under the requested exact-match contract, with different causes. Correct extraction may require preserving inline text adjacency before capturing the outline.

Kubernetes Pod phases and MDN WebAssembly number types both had an exact source group outside the baseline shortlist. Each landed fourth on the schema-aware ranker. Appending supplementary candidates tests retrieval recall while retaining the original candidates and gate. Replay archive for the five-arm comparison: `aa3b052b-55ce-4ee6-833a-3ed0c092a060`.

## Retrieve additional evidence on abstention

The first variant appended up to four new candidates from the schema-aware ranker in the first request. The second retained the original request and queried the extra candidates only after the model selected none. Both retained the dual gate for acceptance.

| Comparison                                |               Current gate |  Supplementary candidates |
| ----------------------------------------- | -------------------------: | ------------------------: |
| Appended candidates, targeted replay      | 20/22 passed, 12 fallbacks | 20/22 passed, 8 fallbacks |
| Appended candidates, full list regression |  70/70 passed, 8 fallbacks | 69/70 passed, 9 fallbacks |
| Retry after abstention, targeted replay   | 14/16 passed, 12 fallbacks | 14/16 passed, 8 fallbacks |
| Retry targeted median / p95               |             4.64 / 11.08 s |            2.35 / 11.23 s |
| Retry targeted estimated USD / 1k         |                     $0.414 |                    $0.274 |

Both approaches recovered all four Kubernetes and WebAssembly answers directly. The appended version caused additional fallbacks on MDN and lost one RockAuto fallback result in the broader replay. No direct accepts failed in these comparisons. The retry result is a targeted development result. A new set should include sources that are absent from both shortlists. This will measure the extra round trip and catch bad accepts when the first abstention was correct. The appended variant is archived. The retry remains available for the live comparison.

Archives: appended targeted `9df8152c-6cea-4177-8e86-8ccda4843b3f`, appended full regression `03a98a4e-3e67-4bee-a438-7e0f620a30c8`, retry `34635cef-ea8c-4650-ba4e-d74ce206f36f`.

The GitHub trace showed the chosen slot contained the prefixes. Stagehand's colon-label cleanup removed them while copying. List values now preserve unspaced colons. Scalar normalization keeps its previous behavior. The targeted rerun kept the prefixes, and the frozen GitHub grader still failed on the space already present in the snapshot. The final list-copy change passed all 35 known list tasks in one replay round, with four fallbacks and zero wrong accepts. Archives: GitHub rerun `75be36e4-27cf-469e-abd5-8d359f66a1ce`, final list regression `bde79d67-2b1b-46f0-9c92-779fed8a7f09`.

## Reproduce

```sh
node --env-file=.env --import tsx packages/sdk-ts/scripts/system-one/providerGroupProbe.ts
node --env-file=.env --import tsx packages/sdk-ts/scripts/system-one/scalarReaderProbe.ts
REPLAY_TASKS=hold7_kubernetes_pod_phases,hold7_wasm_number_types REPLAY_ARMS=runtime-decider-v13,runtime-decider-v13-retry-shortlist REPLAY_ROUNDS=2 node --env-file=.env --import tsx packages/sdk-ts/scripts/system-one/replay.ts
```

## Design recommendation

Measure evidence availability before tuning acceptance. If the right scope was omitted, recover it from a different retrieval source. If the right scope was present and the mapping fails, inspect the requested fields, slots, and copy transformations. If the accessibility snapshot lost exact text, improve capture or read the matched DOM node. A repeated model judgment cannot restore text missing from its input.

For longer lists, select a structured group or an explicit scope, then copy rows by source identity and validate coverage. For bounded scalar evidence, compare Locate and Clairic as readers using span-aware scoring and field-specific normalization. Evaluate the generated answer and the evidence separately. Measure one model plus Luna fallback end to end and keep the direct and fallback timing distributions visible.

## Missing-evidence check

After commit `3c66383e3`, pinned Decider v1.3 ran 15 missing-evidence cases and two retry-only controls twice. The missing cases removed groups matching the labeled source boundaries and row count from both shortlists. The controls retained the supplemental Kubernetes and WebAssembly groups. The probe uses the current dual gate, and only retries when the initial choice abstains. The first run completed every request.

| Selection probe                                        | Result                                |
| ------------------------------------------------------ | ------------------------------------- |
| Missing evidence, wrong accepts in the first shortlist | 4/30 across two tasks                 |
| Missing evidence, additional wrong accepts from retry  | 2/30, both on curl                    |
| Controls with the correct group only in the retry      | 4/4 recovered and extracted correctly |

With the correct labels removed, curl's first shortlist abstained. The retry selected the prose section containing labels and explanations, at 0.970 choice confidence and 0.764 predicate score. Full extraction with fallback disabled refused both because there was no usable field mapping. The Python docs selection returned six project-information links and passed the runtime checks even though the task asked for the documentation sections. Both x-rates selections failed schema validation. These are deliberately altered shortlists on known snapshots. They do not estimate the frequency of these errors on live pages.

Keep the retry in replay. The next isolated test should compare the existing acceptance rule against a source-coverage requirement that can distinguish a partial group from the requested list. Cross-check it against the four successful retry-only controls and the known list regression.

Archives under `runs/group-probes/`: selection `d464dd97-2841-4ea8-a646-1034133096f0`, retry accepts through extraction `f093686d-6817-4cb7-b8e1-b52d45e0fb11`, targeted extraction of all erroneous picks `d9b16f4b-a32a-4beb-91c6-ada348d22f7e`.

```sh
GROUP_PROBE_EXTRACT=1 node --env-file=.env --import tsx packages/sdk-ts/scripts/system-one/shortlistAbstentionProbe.ts
```

## Source-coverage check

The replay arm checks whether the snapshot contains a larger, disjoint group of the same record role with a label that matches the task's wording. It checks link coverage for required URL fields. If the selected group lacks a matching label, the arm abstains before mapping. The check inspects all generated groups, including groups deliberately excluded from the decision model's shortlists. It adds no model request and leaves the SDK default on the existing gate.

| Comparison                                                          |    Retry alone | Retry with source coverage |
| ------------------------------------------------------------------- | -------------: | -------------------------: |
| Wrong direct extractions when both shortlists lack a matching group |           2/30 |                       0/30 |
| Retry-only controls recovered directly                              |            4/4 |                        4/4 |
| Known-list replay, including two retry controls                     |          37/37 |                      37/37 |
| Fallbacks in that replay                                            |              4 |                          4 |
| Replay p50 / p95                                                    | 1.10 / 10.51 s |              1.16 / 9.84 s |

The check caught both Python docs partial lists. The existing mapping and schema checks caught the curl and exchange-rate selections. The selection probe still recorded six wrong group picks. The baseline missing-evidence count combines the original selection run with targeted extraction replays of accepted groups. The coverage arm repeated selection and extraction under the same omission rules. An earlier targeted run recovered three of four controls because one Kubernetes selection disagreed before retry. The broader negative run recovered four of four. These snapshots informed the rule and measure regression behavior. The check needs an independent live test, especially instructions that mention several sections or paraphrase a heading.

Archives: broad probe `runs/group-probes/cca75b5c-5886-4471-9bba-558a6b8fb059/`, focused controls `runs/group-probes/3c66febf-f270-4dc6-8baa-62a9562cd5dc/`, paired replay `runs/archive/7e80d0a0-49bb-48a9-ae3d-3a1235013028/`.

```sh
GROUP_PROBE_EXTRACT=1 GROUP_PROBE_SOURCE_COVERAGE=1 node --env-file=.env --import tsx packages/sdk-ts/scripts/system-one/shortlistAbstentionProbe.ts
```

The choice-only, rich-choice, wider initial shortlist, and selected-predicate extraction arms were removed after their comparisons. The replay archives retain source and results. The provider group probe still uses choice questions to measure ranking and abstention in isolation.

## Live SDK comparison

Three rotated rounds over seven live URLs produced 21 scores per arm. Five tasks were new pages and two were known retry controls. Both Decision arms used pinned Decider v1.3. Luna used GPT-6 Luna through Vercel AI Gateway. The candidate ran through the public SDK against an isolated extension build that passed `source-coverage` to the extraction service. The normal extension build was restored.

| Arm                                    | Passed | Wrong direct answers | Luna fallbacks | Extract p50 / p95 | End-to-end p95 | Mean input tokens | Est. USD / 1k |
| -------------------------------------- | -----: | -------------------: | -------------: | ----------------: | -------------: | ----------------: | ------------: |
| Current Decider + fallback             |  18/21 |                    3 |             12 |     4.69 / 6.03 s |         7.24 s |            24,709 |        $2.363 |
| Decider with retry and source coverage |  18/21 |                    3 |              7 |     1.63 / 6.18 s |         8.45 s |            11,964 |        $1.045 |
| Luna                                   |  21/21 |                    — |              — |     3.89 / 7.72 s |         9.11 s |            28,278 |        $2.907 |

Eight candidate runs retried. Five answered directly, all on the two known controls. The three retries on the fresh Kubernetes Service page still needed Luna. Fallback p50/p95 was 5.03/8.23 s for the current path and 5.43/8.31 s for the candidate. Percentiles use nearest rank, so fallback p95 is the maximum for these small subsets. Cost estimates use reported Decision usage and the generation callback's usage, including reported cache reads.

Both Decision arms omitted `banner` on every W3C run. The trace shows the correct eight-row group was selected. One row received a different context label, and section votes excluded it even though the subset question said the task wanted the whole group. This is a row coverage failure. Keep the retry and source check experimental until a section-filter change passes this regression and independent live tasks.

The initial MDN Promise grader omitted the two experimental methods that the live page lists. All 63 results were rescored uniformly with the corrected reference, ignoring the trailing Experimental badge. The raw records, original and corrected graders, rescore script, patch, and extension hashes are preserved under `runs/plan-validation/live-coverage-20261114T203041Z/`. The corrected task is in `liveCoverageTasks.ts`. [MDN static methods](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise#static_methods) · [W3C landmarks](https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA11)

## Row coverage after nested headings

The W3C snapshot showed that the first landmark row borrowed a heading from a preceding sibling section. When Stagehand projected the group into the correct heading scope, that row kept a different context from the other seven. Section votes then discarded it. The data view now prefers a preceding heading inside the current container and avoids duplicating the scope heading when it already labels a row. The section filter is still available for genuinely separate sections.

| Check                                         | Before | After |
| --------------------------------------------- | -----: | ----: |
| Frozen list replay, current Decider           |  41/42 | 42/42 |
| Frozen list replay, retry and source coverage |  41/42 | 42/42 |
| W3C live regression                           |    0/2 |   2/2 |
| HTML table and nginx live controls            |    4/4 |   4/4 |

The before and after replays used identical frozen inputs in separate runs. W3C was the only wrong direct answer in each before arm. Both after arms still selected the first table from the merged six-row Web Scraper group and returned the requested three rows. Fallback counts were eight for current Decider and six for the candidate in both replays. The W3C live retest used the unmodified controller with the old and new extension builds, in reversed order for round two.

Replay archives: before `a8a52570-9b62-43fa-86d8-5914eefe12b0`, after `2854c3f1-947d-4ef9-b5cf-54651f615f64`. Live results and build patches are under `runs/plan-validation/live-row-scope-20261115T040244Z/`.

A follow-up used the corrected build for all arms on two fresh tasks and two known retry controls. Redis asked for the general-purpose list only. Python asked for the combinatoric iterator table only. Each task ran twice with rotated arm order. The fresh references were fixed before inference. [Redis data types](https://redis.io/docs/latest/develop/data-types/compare-data-types/) · [Python itertools](https://docs.python.org/3.12/library/itertools.html)

| Live arm with row fix                  | Passed | Wrong direct answers | Luna fallbacks | Extract p50 / p95 | Est. USD / 1k |
| -------------------------------------- | -----: | -------------------: | -------------: | ----------------: | ------------: |
| Current Decider + fallback             |    8/8 |                    0 |              5 |     4.76 / 7.28 s |        $3.524 |
| Decider with retry and source coverage |    8/8 |                    0 |              0 |     1.80 / 3.31 s |        $0.063 |
| Luna                                   |    8/8 |                    — |              — |     4.08 / 4.90 s |        $4.723 |

Four candidate runs retried and all four answered directly on the known controls. On the fresh Python task, the current arm abstained once while the candidate selected the right table on its initial request. That difference occurred before the retry or coverage check. The cost and tail estimates are sensitive to the small, deliberately fallback-heavy set. Its p95 is the maximum of eight. Keep the candidate in the benchmark until a wider live run measures successful retries on fresh pages and retry followed by Luna. Raw results are in `followup.jsonl` in the live archive above.

## Fresh retry promotion check

The row-corrected builds ran five new URLs in three rotated rounds. Tasks covered a numbered function list, a reference table, pricing cards, two competing runner tables, and revision notation with punctuation. Graders were frozen before inference.

| Live SDK arm                           | Exact passes | Wrong direct answers | Luna fallbacks | Retry attempts | Extraction p50 / p95 | Mean input tokens | Est. USD / 1k |
| -------------------------------------- | -----------: | -------------------: | -------------: | -------------: | -------------------: | ----------------: | ------------: |
| Current Decider + fallback             |         9/15 |                    3 |              9 |              0 |        4.53 / 7.15 s |             9,385 |        $0.830 |
| Decider with retry and source coverage |         9/15 |                    3 |              9 |              0 |        4.78 / 5.92 s |             9,384 |        $0.731 |
| Luna                                   |        12/15 |                    — |              — |              — |        5.40 / 8.12 s |            33,110 |        $3.334 |

All nine candidate fallbacks came from group disagreement. Retry is reached only after the first choice abstains. The coverage check never fired. Input use was effectively identical between the two Decision arms. With 15 observations, p95 is the maximum. The observed wall times and cost estimates cannot be attributed to retry or coverage because those paths did no work in this run.

Both Decision arms selected the correct SQLite group and returned all seven function names with a trailing opening parenthesis. The instructions requested names only, so all six outputs failed. Each arm also returned the correct Neon plan names in all caps, which failed the strict title-case reference. As a diagnostic, ignoring only Neon casing gives 12/15 for each Decision arm and 15/15 for Luna. The frozen scores above stand.

Keep current Decider with Luna fallback as the SDK pattern and keep the verified heading fix. Leave retry and source coverage in the benchmark. Prioritize exact extraction of grounded text spans and rejection of malformed direct results. Avoid another broad retry run until the task design can distinguish an explicit abstention from a group disagreement. [SQLite function list](https://www.sqlite.org/lang_datefunc.html) · [Neon plan names](https://neon.com/pricing)

The archive includes all 45 outputs, frozen task definitions, build hashes, and the candidate wiring patch at `runs/plan-validation/live-retry-promotion-20261115T050704Z/`.

## Exact copying

SQLite's overview list exposes the function name and its opening parenthesis in one accessibility text node. The mapper previously copied that node verbatim when the task requested bare names. The list mapper now offers the identifier before the opening parenthesis when the slot's samples have that structure. It still offers the full text for tasks seeking the signature or punctuation. Code copies the selected span from each source row. This adds no model request.

| Check                                      | Result                                            |
| ------------------------------------------ | ------------------------------------------------- |
| SQLite names, previous live run            | 0/3, all names had a trailing opening parenthesis |
| SQLite names, after span choice            | 2/2 frozen replay and 2/2 live, all direct        |
| MDN Promise methods, parentheses requested | 2/2 frozen replay and 2/2 live, all direct        |
| Known list regression                      | 42/42, zero wrong direct answers, eight fallbacks |

GitHub exposed a separate problem. Stagehand's accessibility outline contained `repo:USERNAME/ REPOSITORY`. The XPath for that cell resolved to `repo:USERNAME/REPOSITORY` from both rendered `innerText` and DOM `textContent`. The same XPath and accessibility cell text appeared in the original and recaptured snapshots. The replay overlay substituted the observed rendered string for that one cell, preserving the rest of the outline. With the original outline, the Decider cascade and Luna each scored 0/2. With the overlay, both scored 2/2. The cascade still fell back on group disagreement. This was a one-cell evidence experiment. A general DOM reader should use the matched source element and preserve meaningful spaces.

The exact-copy live results, replay overlay, DOM observations, and probe scripts are under `runs/plan-validation/exact-copy-20261115T051339Z/`. Replay archives: targeted `165993a3-ac57-4b7b-b3aa-c1180a920a94`, list regression `e8ff8873-8a44-44ac-9532-f48f25d5bf66`.

### Bounded DOM reader

The opt-in experiment reads at most 32 main-frame table cells in one browser batch. Each cell must match a snapshot XPath and contain a single visible code element whose rendered text matches the entire cell. It substitutes the rendered string only when both strings match after ignoring ordinary spaces. Scoped, ignored-locator, and screenshot extraction do not use this reader. Both Decider mapping and its Luna fallback see the resulting outline.

| Live SDK case                 | Current cascade | With DOM reader | With DOM reader path |
| ----------------------------- | --------------- | --------------- | -------------------- |
| GitHub repository qualifiers  | 0/3             | 3/3             | Luna fallback        |
| Intentional spaces in commands | 3/3             | 3/3             | Decider direct       |
| SQLite function names         | 3/3             | 3/3             | Decider direct       |
| Separate tables               | 3/3             | 3/3             | Luna fallback        |
| Total                         | 9/12            | 12/12           | 6 direct, 6 fallback |

The GitHub reader inspected 24 cells and corrected two in 3–5 ms per run on the final build. Decider still disagreed on the group all three times. Both arms used six Luna fallbacks and 16,212 input / 81 output Decider tokens. Luna used 79,309 input / 2,718 output tokens on baseline and 79,357 / 1,853 with the final reader. This run measures exactness on known cases and controls. Sample size and Luna output variance limit latency and cost comparisons.

A Chromium probe retained a real space in `npm run lint` while correcting one surplus space. It also rejected a mismatched snapshot value, a code cell with extra prose, hidden code, and a cell with multiple code elements. Keep the reader behind the internal benchmark switch. If fresh pages justify broader use, test a shared snapshot fix so normal extraction can benefit too.

The benchmark archive is `runs/plan-validation/dom-code-20261115T053007Z/`. It contains the alternating baseline and initial treatment runs, three confirmation rounds with the final treatment, the Chromium probe, and the build wiring. To reproduce, set `domCodeTextExperiment: true` in the controller's extraction service call for the treatment build. Use `LIVE_TASKS=hold7_github_repo_qualifiers,code-cell-spaces,promotion_sqlite_date_functions,separate-tables LIVE_ARMS=decider LIVE_ROUNDS=3` with `live.ts`.
