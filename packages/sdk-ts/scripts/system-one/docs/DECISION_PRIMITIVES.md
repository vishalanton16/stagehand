# Decision primitives and extraction evidence

Current cleanup status: see [CLEANUP_RESULTS.md](./CLEANUP_RESULTS.md). Prototype flags and source paths below describe the measured pre-cleanup implementations unless stated otherwise. Historical results and caveats are preserved.

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

### Frozen page comparison

Eight captured pages and a synthetic zero/absence control ran twice. The evaluator froze the expected values and each page's Stagehand fact sheet before calling providers. Locate and Clairic received identical sheets and field instructions. Direct copy used the current mapper on the same snapshots, with its fact choices and record-group lookup. The check-only arm used the SDK's production scalar reader and acceptance checks. The two mapper arms stop at abstention, so their costs exclude Luna.

| Arm                             | All fields correct and accepted | Correct fields | Exact spans | Median | Mean billed input tokens | Cost per 1,000 |
| ------------------------------- | ------------------------------: | -------------: | ----------: | -----: | -----------------------: | -------------: |
| Decider direct copy             |                            8/18 |          22/36 |           — | 582 ms |                    2,464 |        $0.0493 |
| Decider + SDK check-only Locate |                           10/18 |          26/36 |           — | 700 ms |                    3,346 |        $0.0669 |
| Decider v1.3 Locate             |                           18/18 |          36/36 |       30/30 | 509 ms |                      883 |        $0.0177 |
| Decider Flash v1.3 Locate       |                           14/18 |          32/36 |       20/30 | 390 ms |                      883 |        $0.0088 |
| Clairic text                    |                           10/18 |          26/36 |       24/30 | 340 ms |                    1,825 |        $0.1825 |
| Clairic typed                   |                            8/18 |          24/36 |       10/12 | 275 ms |                    1,426 |        $0.1426 |

Exact-span scoring requires the expected text at a valid offset. Where a value could come from several places, the grader checks the required source row. Typed numeric responses and mapper outputs do not supply comparable offsets. The typed Clairic denominator covers its text fields only. Absence is scored separately. Both Locate variants omitted all six absent fields. Both Clairic variants returned a value for every absent field, including a textbook edition and a defect total. The providers completed every request without truncation. Costs use returned input-token counts and published rates. Output tokens are free for these arms. [Perplexity pricing](https://docs.perplexity.ai/docs/getting-started/pricing#decisions-api-pricing) · [Clairic billing](https://developers.cloudflare.com/workers-ai/models/clairic/)

The current check caught eight wrong copies and abstained, with zero wrong direct accepts. The errors were the textbook title, PyPI Python version, Eiffel Tower dates, and the WCAG conformance level. The disagreements were often about where the value ended. Clairic's use of shared numeric passes lowered billed input by 22% compared with its text arm, while typed extraction returned 687.6 for the 687-Earth-day Martian year and 1342.1 for eBook number 1342. Copying the source span and normalizing it in code avoids those two errors.

Test Decider Locate v1.3 as the primary reader for flat scalar schemas next. Verify source offsets and numeric parsing, then measure coverage, wrong accepts and Luna fallback on fresh pages. Include missing evidence and plausible wrong spans. Keep the SDK's existing check-only path while measuring the candidate.

Reproduce with `node --env-file=.env --import tsx packages/sdk-ts/scripts/system-one/realScalarProbe.ts`. Archives under `runs/real-scalar-probes/` contain frozen sheets, hashes, raw spans and provider usage. The direct comparison is `45efd9d9-1df4-41eb-af7b-9a436e74e77f`. The check-only follow-up is `91258186-e9f5-49f0-b4e7-bc6083b5774e`.

### Locate primary through the live SDK

Seven fresh pages and two synthetic controls ran twice through the public SDK. The graders came from browser captures and were frozen before any provider call. Locate-first used the same fact shortlist as the SDK reader, with at most eight flat scalar fields and 12,000 characters of evidence. It required an exact Unicode offset and schema-valid output. Numeric spans had to contain a single literal number. A missing required span sent the request directly to Luna.

| Approach                       | Passed | Wrong direct accepts | Luna fallbacks | Extraction p50 / p95 | Cost per 1,000 |
| ------------------------------ | -----: | -------------------: | -------------: | -------------------: | -------------: |
| Current SDK                    |  18/18 |                    0 |              6 |       1.25 / 15.23 s |         $0.302 |
| Locate-first                   |  16/18 |                    2 |              2 |        0.66 / 4.87 s |         $0.037 |
| Luna                           |  17/18 |                    — |              — |        4.01 / 9.57 s |         $1.211 |
| Required-only routing, posthoc |  18/18 |                    0 |              2 |        0.66 / 4.87 s |         $0.053 |

Extraction time starts after navigation and includes snapshot capture. The p95 is the slowest run at this sample size. Costs use provider-reported usage, including the Luna fallback. The current SDK used 94,364 Decider input tokens and 32,276 Luna input / 625 output. Locate-first used 23,004 Decider input tokens and 1,160 Luna input / 165 output. Luna alone used 202,689 input / 3,060 output. None of the Luna calls reported cached input. [Perplexity pricing](https://docs.perplexity.ai/docs/getting-started/pricing#decisions-api-pricing) · [Vercel Luna pricing](https://vercel.com/ai-gateway/models/gpt-6-luna)

Locate-first answered HTTPX and IANA directly in all four runs where the current SDK used Luna. It wrongly returned `9007199254740991` as an optional browser name on both MDN runs. The number was a real span and the schema accepted it as a string. The current SDK omitted the browser field. Luna alone returned the wrong numeric value on one MDN run. The date-format control required Luna in both SDK paths. A separate clipping control removed a required identifier from the fact sheet. Locate abstained and Luna recovered it in both runs.

The required-only row combines observed runs after grading, using the current SDK for the two tasks with optional fields and Locate-first for the other seven. Test this routing on fresh data before changing the SDK. A matched same-request presence probe assigned the spurious MDN field 0.006 in both rounds and gave the two present controls at least 0.976. A separate wording variant gave the valid HTTPX license less than 0.31. Keep presence gating in the benchmark until it can distinguish correct omission from a missed optional value.

Archive `runs/plan-validation/locate-primary-20261115T054618Z/` contains the captures, graders, fact sheets, raw timings and usage, presence probes, and build patch. The runtime switch is retired. On the pre-cleanup source archived below, add `locatePrimaryExperiment: "all-scalars"` to the controller's extraction service call. Run `live.ts` with `LIVE_ARMS=locate-primary` and `LIVE_TASKS` set to the seven names in `locatePrimaryTasks` plus `scalar-zero-and-absence,scalar-normalized-date`. Run `scalar-clipped-source` separately.

### Required-only routing on a fresh set

Seven new pages each ran twice through the public SDK. Five tasks had only required fields and two had an optional field. The candidate used Locate-first for the five eligible tasks and the current mapper for both optional schemas. The candidate also rejects unsafe integers before copying them into a JavaScript number.

| Approach              | Passed | Wrong direct accepts | Luna fallbacks | Extraction p50 / p95 | Cost per 1,000 |
| --------------------- | -----: | -------------------: | -------------: | -------------------: | -------------: |
| Current SDK           |  12/14 |                    0 |             12 |        4.56 / 6.95 s |         $3.002 |
| Required-only routing |  10/14 |                    2 |              4 |        1.00 / 4.52 s |         $0.234 |
| Luna alone            |  10/14 |                    — |              — |        2.62 / 4.34 s |         $2.955 |

Extraction timing includes snapshot capture after navigation. The p95 equals the slowest run at this sample size. Cost includes fallback and uses reported tokens. The current SDK used 62,554 Decider input tokens and 404,264 Luna input / 1,395 output, including 3,819 cached input tokens. The candidate used 32,674 Decider input tokens and 23,662 Luna input / 508 output. Luna alone used 408,655 input / 1,686 output, including 3,739 cached input tokens. Replacing the large IETF and NGINX snapshots with bounded sheets contributed to the cost gap.

- **NIST:** Locate returned the factors `1027` and `10-30` for the required symbols `R` and `q`. Both wrong values were valid source spans. The current SDK abstained and Luna recovered both symbols.
- **Serde:** The version appeared in the browser snapshot but fell outside the fact shortlist. Locate abstained and Luna recovered the version in both rounds.
- **Optional fields:** Both SDK builds used the mapper. They correctly omitted an absent end-of-support date on IANA. They preserved the optional release date on Python.org, where both failed the exact version check by returning `Python 3.13.0` instead of `3.13.0`. Luna alone made the same Python mistake and added an empty optional value on IANA.

NIST's table has a purpose column that spans multiple rows. The AX outline omits the covered cell from subsequent rows. Stagehand counted the remaining cells by position and applied the header one column to the left. A DOM probe confirmed the span and rebuilt the table with correct headers. With the SDK's questions held fixed, Locate still selected the wrong factors in all three runs on the full corrected table and all three on the two relevant rows. On those same two rows, questions naming the requested prefix and the Symbol column for each field gave Locate and Decider choice 3/3 each. The diagnostic supplied the rows and field-specific questions. Automatic row and column selection remain untested.

Keep the current SDK path. The next candidate should bind the requested row and column before copying a table-backed field, then abstain when it cannot establish the binding. Test row selection and cell choice independently on fresh tables with spans, distractors, and missing columns.

Archive `runs/plan-validation/locate-required-20261115T055615Z/` has the seven captures, graders, source sheets, browser table data, raw usage and model responses, and the build patch. The RFC Editor capture lost its CDP connection, so the benchmark used the IETF Datatracker copy of RFC 9000. On the pre-cleanup source, reproduce with `locatePrimaryExperiment: "required-only"`, the seven names in `locateRequiredTasks`, and `LIVE_ARMS=locate-required`.

### Select a table cell before reading its value

Five fresh pages supplied six tasks, including a required code whose table cell was empty. Each task ran twice. The grader and candidate lists were frozen before provider calls. The prototype expands HTML row and column spans, labels cells with their row and column, and gives Decider up to 16 candidates per field. Code copies the selected cell or abstains if the value is missing. The stricter arm asks separate row and column questions in the same request and checks that both match the chosen cell.

| Fresh comparison                          | Passed | Wrong accepts | Positive tasks sent to fallback | Median | Decider cost per 1,000 |
| ----------------------------------------- | -----: | ------------: | ------------------------------: | -----: | ---------------------: |
| Required-only Locate                      |  10/12 |             0 |                               2 | 722 ms |                $0.0243 |
| Current mapper and check-only Locate      |  10/12 |             0 |                               2 | 820 ms |                $0.0837 |
| Labeled cell choice and copy              |  10/12 |             0 |                               2 | 509 ms |                $0.0306 |
| Cell choice with row and column agreement |  10/12 |             0 |                               2 | 608 ms |                $0.0516 |

All arms abstained on the missing Klingon code. Those two abstentions count as passes. Required-only Locate rejected the correct PostgreSQL span `16 bytes` because it expects a bare number. Cell copy normalized the byte count. The current mapper and both cell arms missed the Albanian task. The selected cell contains both the bibliographic code and the terminology code, so copying the whole cell fails the schema. The agreement check also saw different row IDs for two fully identical rows of the same table.

The follow-up compared two ways to recover sub-values. Both call Locate only when the selected, nonempty cell cannot be copied as the requested type. The agreement arm allows an equivalent row only when the entire expanded row matches inside the same table. It still requires the same column.

| Follow-up across the fresh cases and NIST                     | Passed | Wrong accepts | Median | Decider cost per 1,000 |
| ------------------------------------------------------------- | -----: | ------------: | -----: | ---------------------: |
| Choose one labeled cell, Locate inside that cell if needed    |  14/14 |             0 | 539 ms |                $0.0300 |
| Require matching row and column, with equivalent rows allowed |  14/14 |             0 | 510 ms |                $0.0505 |

Both variants recovered the NIST symbols by selecting the actual Symbol cells. Both extracted Albanian's terminology code from inside its selected cell and abstained on the empty Klingon cell. The second table reuses the fresh cases after diagnosis and adds the known NIST case. It measures model work over frozen inputs and excludes browser capture and Luna. Cost uses reported Decider input tokens. [Perplexity pricing](https://docs.perplexity.ai/docs/getting-started/pricing#decisions-api-pricing)

Use labeled cell choice and direct copy as the next candidate. Scope Locate to that cell only when the schema needs a sub-value. The row and column agreement arm spent 69% more input tokens with identical accuracy on this set. Preserve it for a larger ambiguity test. The current SDK stays on its existing path while automatic routing, candidate recall, and wrong accepts are measured through the live SDK.

Archive `runs/plan-validation/table-binding-20261115T060542Z/` includes browser captures, graders, candidate IDs, chosen cells, provider usage, and layout checks for row spans, column spans, duplicate rows, and empty cells. The SQLite page was captured but excluded because its relevant affinity examples were prose. To reproduce on the archived captures, run `node --env-file=.env --import tsx packages/sdk-ts/scripts/system-one/tableBindingProbe.ts <capture-directory>`. Use a copy of the directory to preserve the archived manifest and results.

### Live SDK routing for table cells

Six fresh pages and three controls ran twice per arm through the public SDK. The candidate uses the table path only for flat, required scalar schemas on an unscoped text extraction. It reads bounded HTML tables in one browser batch and requires a lexical anchor in both a row and a column for every field. Ineligible requests use the current mapper. Once the table arm requests a decision, a missing or invalid selected cell sends the request to Luna. Locate runs only on the selected cell when the original value cannot satisfy the schema.

| Population                       | Approach       | Passed | Wrong direct accepts | Luna fallbacks |      p50 / p95 | Cost per 1,000 |
| -------------------------------- | -------------- | -----: | -------------------: | -------------: | -------------: | -------------: |
| All runs                         | Current SDK    |  14/18 |                    4 |              4 |  0.94 / 8.54 s |         $1.874 |
| All runs                         | Table-cell SDK |  16/18 |                    2 |              4 | 0.77 / 12.81 s |         $1.870 |
| Same tasks that routed to tables | Current SDK    |  10/12 |                    2 |              2 |  0.93 / 4.49 s |        $0.0566 |
| Same tasks that routed to tables | Table-cell SDK |  12/12 |                    0 |              2 |  0.64 / 3.80 s |        $0.0297 |

The candidate used the table path on all 12 table-backed runs and the mapper on all six prose or mixed runs. PostgreSQL, IANA, Python's array table, and the competing-tables control passed directly in both builds. The table path normalized PostgreSQL's byte values, sent the empty cell to Luna, and recovered the compound code directly with one cell-scoped Locate request. Both builds still returned the wrong CSS viewport unit on the prose task. The mixed datetime page used Luna in both arms and dominated full-set cost and p95. The p95 is the slowest run at these sample sizes.

Table preparation took 1–14 ms on routed runs, including browser evaluation and ranking. On those runs, Decider billed 7,574 input tokens with the table path versus 23,240 with the current mapper. Luna used 1,286 input / 152 output versus 1,304 input / 168 output. All costs include Luna. The initial candidate build emitted an undefined field in the routing log and interrupted the mapper bypass. The table above uses the complete corrected rerun. [Perplexity pricing](https://docs.perplexity.ai/docs/getting-started/pricing#decisions-api-pricing) · [Luna pricing](https://vercel.com/ai-gateway/models/gpt-6-luna)

Keep the table path opt-in for benchmarks. The next promotion check should exercise grouped headers, repeated tables, and requests with weak field descriptions on fresh pages. Test whether eligible table fields can use the cell path while prose fields use the mapper in the same extraction. Compare end-to-end cost and p95 with the current all-or-nothing routing.

Archive `runs/plan-validation/live-table-cells-20261115T061519Z/` contains captures, graders, build variants, usage, and routing logs. Reproduce with the `tableCellExperiment: true` build patch, `LIVE_ARMS=table-cell`, and the six names in `liveTableCellTasks` plus `table-cell-competing-tables,table-cell-empty-required,table-cell-compound-value`.

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

Both approaches recovered all four Kubernetes and WebAssembly answers directly. The appended version caused additional fallbacks on MDN and lost one RockAuto fallback result in the broader replay. No direct accepts failed in these comparisons. The retry result is a targeted development result. A new set should include sources that are absent from both shortlists. This will measure the extra round trip and catch bad accepts when the first abstention was correct. The appended and retry variants are archived.

Archives: appended targeted `9df8152c-6cea-4177-8e86-8ccda4843b3f`, appended full regression `03a98a4e-3e67-4bee-a438-7e0f620a30c8`, retry `34635cef-ea8c-4650-ba4e-d74ce206f36f`.

The GitHub trace showed the chosen slot contained the prefixes. Stagehand's colon-label cleanup removed them while copying. List values now preserve unspaced colons. Scalar normalization keeps its previous behavior. The targeted rerun kept the prefixes, and the frozen GitHub grader still failed on the space already present in the snapshot. The final list-copy change passed all 35 known list tasks in one replay round, with four fallbacks and zero wrong accepts. Archives: GitHub rerun `75be36e4-27cf-469e-abd5-8d359f66a1ce`, final list regression `bde79d67-2b1b-46f0-9c92-779fed8a7f09`.

## Reproduce historical probes

Use the [pre-cleanup source](#active-extraction-paths) for retired retry and source-coverage commands.

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

The next isolated test compared the existing acceptance rule with a source-coverage requirement that can distinguish a partial group from the requested list. Cross-check it against the four successful retry-only controls and the known list regression.

Archives under `runs/group-probes/`: selection `d464dd97-2841-4ea8-a646-1034133096f0`, retry accepts through extraction `f093686d-6817-4cb7-b8e1-b52d45e0fb11`, targeted extraction of all erroneous picks `d9b16f4b-a32a-4beb-91c6-ada348d22f7e`.

```sh
GROUP_PROBE_EXTRACT=1 node --env-file=.env --import tsx packages/sdk-ts/scripts/system-one/shortlistAbstentionProbe.ts
```

## Source-coverage check

The replay arm checks whether the snapshot contains a larger, disjoint group of the same record role with a label that matches the task's wording. It checks link coverage for required URL fields. If the selected group lacks a matching label, the arm abstains before mapping. The check inspects all generated groups, including groups deliberately excluded from the decision model's shortlists. It added no model request and used the existing SDK gate as its baseline.

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

| Live SDK case                  | Current cascade | With DOM reader | With DOM reader path |
| ------------------------------ | --------------- | --------------- | -------------------- |
| GitHub repository qualifiers   | 0/3             | 3/3             | Luna fallback        |
| Intentional spaces in commands | 3/3             | 3/3             | Decider direct       |
| SQLite function names          | 3/3             | 3/3             | Decider direct       |
| Separate tables                | 3/3             | 3/3             | Luna fallback        |
| Total                          | 9/12            | 12/12           | 6 direct, 6 fallback |

The GitHub reader inspected 24 cells and corrected two in 3–5 ms per run on the final build. Decider still disagreed on the group all three times. Both arms used six Luna fallbacks and 16,212 input / 81 output Decider tokens. Luna used 79,309 input / 2,718 output tokens on baseline and 79,357 / 1,853 with the final reader. This run measures exactness on known cases and controls. Sample size and Luna output variance limit latency and cost comparisons.

A Chromium probe retained a real space in `npm run lint` while correcting one surplus space. It also rejected a mismatched snapshot value, a code cell with extra prose, hidden code, and a cell with multiple code elements. Keep the reader behind the internal benchmark switch. If fresh pages justify broader use, test a shared snapshot fix so normal extraction can benefit too.

The benchmark archive is `runs/plan-validation/dom-code-20261115T053007Z/`. It contains the alternating baseline and initial treatment runs, three confirmation rounds with the final treatment, the Chromium probe, and the build wiring. On the pre-cleanup source, set `domCodeTextExperiment: true` in the controller's extraction service call for the treatment build. Use `LIVE_TASKS=hold7_github_repo_qualifiers,code-cell-spaces,promotion_sqlite_date_functions,separate-tables LIVE_ARMS=decider LIVE_ROUNDS=3` with `live.ts`.

## Active extraction paths

| Kept                                                                              | Archived                                                               |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Current Decider mapper, dual list gate, scalar Locate check and one Luna fallback | List retry and source-coverage runtime arms                            |
| Table-cell choice and cell-scoped Locate in benchmark SDK builds                  | Flat-page Locate-first and required-only scalar routing                |
| Exact callable-identifier copying and the frozen regression tasks                 | Rendered code-cell overlay and the separate table row and column check |

The frozen table probe now calls the SDK candidate and the current mapper. Earlier probes, graders and raw results remain in their original archives. To reproduce retired implementations, apply `pre-cleanup.patch` from `runs/plan-validation/extraction-cleanup-20261115T062818Z/` to its recorded base, `55d26094a`. That patch includes the uncommitted benchmark sources at the time of cleanup.

After cleanup, the table candidate passed 14/14 frozen runs, including NIST and the missing-cell control. The current mapper passed the five retained list regressions with its normal fallback. A live SDK smoke test passed all four cases, including a prose bypass and a missing-cell fallback.

The next comparison is mixed table and prose extraction. The [live results](#live-sdk-routing-for-table-cells) show a cost reduction on table tasks and comparable cost across the entire workload. The mixed datetime page went to Luna in both arms and dominated cost and p95.

### Mixed table and prose routing through the SDK

The candidate partitions flat required fields by table evidence. It runs the table reader and the mapper in parallel. If either branch abstains, Luna receives the unresolved output fields and the full snapshot. The SDK preserves the fields the other branch validated and checks the merged object against the full schema. All-table tasks keep the table-cell path and prose-only tasks keep the mapper.

Three fresh page tasks, the known Python datetime case and three synthetic controls ran twice per arm. All 42 runs passed. Times are extraction time after navigation and include snapshot capture. Cost uses reported tokens for both providers.

| Approach                     | Passed | Wrong direct accepts | Luna fallbacks |     p50 / p95 | Cost per 1,000 |
| ---------------------------- | -----: | -------------------: | -------------: | ------------: | -------------: |
| Current SDK                  |  14/14 |                    0 |             10 | 3.98 / 8.38 s |         $3.213 |
| All-or-nothing table routing |  14/14 |                    0 |              8 | 3.44 / 9.49 s |         $3.207 |
| Mixed-field routing          |  14/14 |                    0 |              6 | 2.53 / 8.66 s |         $0.896 |

The split recovered both Python datetime runs directly. On each run the baselines sent 161,572 input tokens to Luna. That previously known task accounts for the aggregate savings. Excluding it, estimated cost per 1,000 was $1.025 for the current SDK, $1.005 for all-or-nothing table routing, and $1.034 for mixed routing. MDN rounding still needed Luna for the prose field. Narrowing its output schema reduced Luna input from 54,501 to 54,469 tokens per run because the snapshot was the same.

| Provider input tokens across the 14 runs | Current SDK | Table routing | Mixed routing |
| ---------------------------------------- | ----------: | ------------: | ------------: |
| Decider                                  |      37,790 |        36,796 |        28,338 |
| Luna                                     |     436,236 |       434,932 |       111,668 |

All six mixed-route fallbacks requested only the unresolved fields. The p95 is the slowest run in each arm at this sample size. The mixed p95 was higher than the current SDK's and lower than the table arm's. Keep mixed routing benchmark-only. A fresh set should test whether it avoids expensive fallbacks on other pages and whether retained field values stay correct when Luna fills the rest.

Archive `runs/plan-validation/mixed-fields-20261115T100317Z/` includes SDK results, graders, browser captures, routing traces, and both build patches. The mixed controller experiment uses `tableCellExperiment: "mixed"`. The table-only control uses `tableCellExperiment: true`.

### Bounded evidence for Luna fallback

The candidate tries Luna on the mapper's fact sheet when at least one mixed branch resolved its fields and the sheet is below 9,000 characters and less than half the snapshot. Luna returns the value and a supporting quote for each unresolved field. Code checks the quote against the exact sheet and checks the value against that quote. Missing evidence, invalid quotes, an invalid schema, or a sheet outside the budget route to the existing full-page fallback. The initial guard required a string quote to equal the value. The follow-up accepts a complete literal value inside a longer verbatim quote.

Three fresh pages, the known MDN rounding page, and three synthetic controls ran twice per arm. All 42 SDK runs passed. The follow-up used the same tasks after inspecting initial failures. Timing includes snapshot capture and excludes navigation. Cost includes accepted, rejected, and full-page calls using provider-reported token counts.

| Approach                            | Passed | Bounded accepts | Full-page fallbacks |      p50 / p95 | Cost per 1,000 |
| ----------------------------------- | -----: | --------------: | ------------------: | -------------: | -------------: |
| Full snapshot                       |  14/14 |               — |                  14 |  6.51 / 8.29 s |         $1.712 |
| Bounded, strict quote               |  14/14 |               5 |                   9 | 6.73 / 12.19 s |         $0.984 |
| Bounded, verbatim supporting phrase |  14/14 |               7 |                   7 | 4.74 / 11.21 s |         $0.339 |

The follow-up billed 33,055 Luna input tokens versus 220,016 for full snapshots, including retries. Reported cached input was 8,024 versus 8,644. Python JSON and MDN rounding used the bounded answer in both rounds. In PostgreSQL's binary-type task, Luna quoted words that did not occur together in the evidence, so the full snapshot answered both runs. The p95 is the slowest run in each arm at these sample sizes.

A separate control put the required identifier beyond the fact builder's clipping limit. Luna returned null on the bounded sheet in both rounds. The full snapshot recovered `ORCHID-733` both times. The rejected attempt added 331 input tokens per run and increased median extraction time from 6.96 to 7.61 s in that pair. Quote validation checks the text and the value. A verbatim quote can still support the wrong field or come from the wrong section.

A posthoc replay used bounded results only for the two pages with more than 100,000 snapshot characters and reused the full-page results elsewhere. It scored 14/14 at $0.364 per 1,000 with 8.16 s p95. This illustrates a size gate on known cases. Test the gate on new large pages with plausible distractor quotes and missing evidence before enabling any SDK route.

Archive `runs/plan-validation/bounded-luna-20261115T101516Z/` contains both candidate builds, baseline and follow-up runs, capture evidence, quote audit, and the omitted-source comparison. The build option is `tableCellExperiment: "mixed-bounded"`. The full-snapshot comparator uses `"mixed"`.

### Large-snapshot gate for bounded fallback

The candidate tried bounded evidence only after mixed routing returned unresolved fields on a snapshot of at least 100,000 characters. Three fresh documentation pages, three large synthetic controls, and a known small-page control ran twice per arm. Both arms passed every run.

| Mixed fallback approach    | Passed | Bounded accepts / attempts | Full-page calls |      p50 / p95 | Reported cost per 1,000 | Uncached cost per 1,000 |
| -------------------------- | -----: | -------------------------: | --------------: | -------------: | ----------------------: | ----------------------: |
| Full snapshot              |  14/14 |                          — |              12 |  6.43 / 9.56 s |                  $2.781 |                  $3.297 |
| Bounded on large snapshots |  14/14 |                       2/10 |              10 | 7.75 / 15.40 s |                  $1.874 |                  $2.927 |

Both bounded accepts came from PostgreSQL's mathematical-functions page. The small-page control skipped both bounded attempts. The other eight bounded calls retried on the full snapshot. All retries recovered the correct result. The wrong-section control's shortlist contained the retired identifier `ORCHID-105` and omitted the current `ORCHID-733`. Luna abstained on that shortlist in both runs. The normalization control included the displayed date and required a full-page call for the ISO value.

Both arms billed 37,218 Decider input tokens. Luna reported 437,644 input / 3,297 output tokens for full-page routing, versus 382,483 input / 3,980 output for the size gate. Cached input was 80,314 versus 163,849. The uncached estimate applies the standard input rate to every input token. With the cache discount removed, savings fall from 33% to 11%. At this sample size p95 is the slowest run. It includes snapshot capture and excludes navigation. [Luna pricing](https://vercel.com/ai-gateway/models/gpt-6-luna) · [Perplexity pricing](https://docs.perplexity.ai/docs/getting-started/pricing#decisions-api-pricing)

The 447,305-character SQLite snapshot contained the `sqlite3.connect` signature, but the fact sheet omitted the names of both requested parameters. In a diagnostic replay, exposing the unchanged signature as a searchable fact recovered both values in two runs. Luna cited `timeout=5.0` and `cached_statements=128` verbatim. The current verifier still rejected them because numeric quotes must contain a bare number. Preserving signatures and validating a named assignment with exactly one literal are separate changes to test.

Keep the size gate benchmark-only. Test a coverage gate and the numeric quote change on a fresh set before promotion. Archive `runs/plan-validation/bounded-size-gate-20261115T102810Z/` includes the build patches, source audits, raw usage, and diagnostic quote checks. Use `tableCellExperiment: "mixed-bounded-large"` for the size-gated build and `"mixed"` for its comparator.

### Named numeric defaults in function signatures

The SQLite replay tested retaining the signature and accepting a numeric assignment quote independently. Each evidence variant ran twice. Both quote validators checked the same model replies for that evidence variant.

| SQLite replay                       | Bare-number check | Assignment-aware check |
| ----------------------------------- | ----------------: | ---------------------: |
| Existing shortlist                  |               0/2 |                    0/2 |
| Shortlist with the source signature |               0/2 |                    2/2 |

The missing signature caused Luna to abstain on `timeout`. Retaining it produced `timeout=5.0` and `cached_statements=128` in both rounds. Both quotes occurred verbatim. The bare-number validator rejected them.

The live candidates require a unique signature with a matching numeric assignment for every unresolved field on a large snapshot. The follow-up requires explicit callable and default intent in the field description. Nested assignments and conflicting signatures cannot supply a result. We compared asking Luna to read the identified signature with copying the matched literal in code.

| Mixed fallback approach             | Passed | Wrong signature accepts | Full-page calls |      p50 / p95 | Uncached cost per 1,000 |
| ----------------------------------- | -----: | ----------------------: | --------------: | -------------: | ----------------------: |
| Full snapshot                       |  18/18 |                       — |              10 | 6.40 / 11.10 s |                  $3.467 |
| Bounded Luna on matching signatures |  18/18 |                       0 |               6 |  2.71 / 8.00 s |                  $1.978 |
| Direct copy of matching defaults    |  18/18 |                       0 |               6 |  1.09 / 9.68 s |                  $1.961 |

Nine live tasks ran twice. Both candidates resolved four runs, two on the known SQLite page and two on a new clipped-signature fixture. On those four runs, the median was 8.61 s for full-page fallback, 3.52 s for bounded Luna, and 1.04 s for direct copy. Both candidates bypassed the clipped overload control and the full snapshot selected the current reference in both rounds. The fresh `re` and `codecs` mixed cases already passed through the mapper. A separate frozen check copied the exact defaults for `re.split`, `codecs.open`, and `statistics.quantiles` without a model call.

Both candidate paths used the same match and precision guard. Direct copy made no additional Luna call on the four resolved runs. Bounded Luna used 2,144 input tokens there. Across all runs, the three arms used 596,981, 335,444 and 333,300 Luna input tokens respectively. Estimated cost per thousand with reported cache reads was $3.203, $1.559 and $1.542. Timing includes snapshot capture and excludes navigation. The p95 is the slowest run in each arm, and the slowest runs included full-page fallbacks outside the signature candidate.

Direct copy remains a replay hypothesis. The production wiring for both signature variants was archived with the mixed and bounded arms.

Archive `runs/plan-validation/signature-evidence-20261115T104245Z/` contains the factorial replay, direct audit, captures and three build patches. The build settings are `tableCellExperiment: "mixed"`, `"mixed-bounded-signatures"`, and `"mixed-signature-copy"`.

## Whole-page accessibility compaction

Compress the text for the existing Luna fallback after Decider routes. The formatter removes encoded node IDs and a sole `StaticText` child that repeats its parent's exact name. It preserves order, indentation, roles, table boundaries, and multiline text. Typed URL fields keep the link IDs needed to reconstruct URLs. Requests with screenshots or explicit node IDs use the original outline.

The frozen set has 16 newly captured pages, four each for pricing, catalogs, API references, and prose. The [task definitions](../compactPageTasks.ts) record the exact graders. The archived first probe used the real extract service and model endpoints with the browser snapshots fixed. Extract timings therefore exclude navigation and snapshot capture. Each cascade ran twice per page. Each direct Luna arm ran once per page.

| Arm                     | Passed | Luna fallbacks | Wrong direct accepts |      p50 / p95 | Luna input tokens | Uncached cost per 1,000 |
| ----------------------- | -----: | -------------: | -------------------: | -------------: | ----------------: | ----------------------: |
| Luna, raw               |  14/16 |              — |                    — | 4.30 / 10.16 s |           248,902 |                  $1.645 |
| Luna, compact           |  15/16 |              — |                    — | 4.28 / 18.28 s |           137,214 |                  $0.959 |
| Decider + Luna, raw     |  30/32 |             18 |                    0 |  3.29 / 9.19 s |           312,270 |                  $1.116 |
| Decider + Luna, compact |  31/32 |             18 |                    0 |  3.28 / 8.07 s |           174,205 |                  $0.681 |

Both cascade arms routed the same 18 cases and used the same 64 decision calls, 110,424 decision input tokens, and 36 Luna calls. The matched fallback subset passed 16/18 raw and 17/18 compact. Its p50 was 4.69 versus 4.77 s, p95 was 13.76 versus 23.37 s, and uncached cost per 1,000 was $1.915 versus $1.141. Removing the largest page, Pathlib, still leaves a 30% uncached cost reduction across the cascade. The only wrong cascade result was `resolve` instead of `Path.resolve`. Raw Luna also omitted the URLs on one books task.

The science-fiction catalog drove the p95 of the fallback subset. On its slowest compact run, the extraction call used 3,305 input tokens versus 4,845 raw. The existing completion call then used 907 reasoning tokens versus 516 raw on the same 368 input tokens. Direct Luna showed the same pattern. With 18 fallback observations and nearest-rank p95, this compares the slowest run in each arm. Timing the two model calls separately is the next test. The compact live SDK smoke passed 6/6 across URL reconstruction, separate tables, and a nested-schema fallback.

Cost uses provider-reported tokens at uncached rates. Including reported cache reads, estimated cascade cost was $0.684 raw and $0.443 compact per 1,000 tasks. [Perplexity pricing](https://docs.perplexity.ai/docs/getting-started/pricing#decisions-api-pricing) · [Vercel Luna pricing](https://vercel.com/ai-gateway/models/gpt-6-luna)

Archive `runs/plan-validation/compact-page-20261115T105934Z/` contains snapshots, the frozen manifest, token and timing logs, the summary script, and the live smoke build patch. `pre-pivot.patch` recreates the retired mixed-field, bounded-Luna, size-gate, and signature variants against the revision in `pre-pivot-base.txt`. The standalone signature parser and its tests remain in the repository.

## The Luna completion round trip

The extraction model returns a schema-validated object. A second, sequential call receives the instruction and that object, without the page evidence. The service discards `progress` and uses `completed` only to choose a log message. The verdict never changes returned fields, advances a chunk loop, or triggers a retry. The benchmark switch skips this call and emits a neutral result log. The SDK result still carries data, usage, and cache status.

The archived completion probe reused the 16 frozen compaction pages, ran each arm three times, rotated arm order within each case and recorded time and reported tokens for extraction and completion separately. The direct Luna arms used raw AX input, while the cascade had the same Decider routes and compact Luna input in both arms. Replay times exclude browser capture. The separate fixed-output check compared Luna and Decider on 16 cases twice each. It tested completeness from the instruction and returned values, including missing rows, missing links, optional absence, and explicit zero.

| Extraction path                             | Passed |     p50 / p95 | Uncached cost per 1,000 | Cost with reported cache per 1,000 |
| ------------------------------------------- | -----: | ------------: | ----------------------: | ---------------------------------: |
| Luna, existing completion                   |  44/48 | 4.19 / 9.35 s |                  $1.651 |                             $0.274 |
| Luna, one call                              |  44/48 | 1.73 / 2.81 s |                  $1.559 |                             $0.183 |
| Decider + compact Luna, existing completion |  45/48 | 3.91 / 9.84 s |                  $0.673 |                             $0.196 |
| Decider + compact Luna, one Luna call       |  45/48 | 1.98 / 3.61 s |                  $0.618 |                             $0.142 |

Both cascade arms accepted 21 cases directly with zero wrong direct accepts and fell back on the same 27. On those matched fallbacks, cascade p95 dropped from 10.34 to 4.22 s. Single-call Luna ran those same cases at 2.74 s p95 and passed 23/27 versus 24/27 in both cascade arms. Among the six repeated book and Homebrew link tasks, removing completion cut cascade median time from 9.64 to 3.36 s. The old completion call alone took 6.37 s median on those cases.

Provider-reported cache reads covered almost all Luna extraction input tokens. The bottleneck measures observed replay latency with a warm provider cache. The uncached cost column prices all reported input tokens at uncached rates. The best cascade cost 60% less at uncached prices than single-call Luna, while its workload p95 was 29% higher and its matched-fallback p95 was 54% higher. Price and latency comparisons on fresh live pages are still pending.

| Fixed-output completion judge | Correct | False complete |     p50 / p95 | Uncached cost per 1,000 |
| ----------------------------- | ------: | -------------: | ------------: | ----------------------: |
| Luna                          |   28/32 |              4 | 3.52 / 6.12 s |                 $0.0983 |
| Decider                       |   32/32 |              0 | 0.44 / 0.75 s |                 $0.0025 |

Luna marked an empty link complete twice. It also marked an empty extraction and a response with unwanted alternate names complete once each. Decider matched the expected verdict on every trial. These fixed outputs test whether the answer meets explicit requirements. They cannot measure source fidelity because neither judge receives the page. A completion verdict can stay an opt-in diagnostic. Remove the mandatory metadata call from the experimental comparison and use single-call Luna as the latency baseline.

The public SDK smoke passed 8/8 with the benchmark switch on. The four direct Luna cases each used one model call. The cascade accepted two cases directly and used one Luna call each on the other two. The fixtures covered URL reconstruction, separate tables, a nested object, and an absent optional field.

Archive `runs/plan-validation/completion-20261115T111412Z/` contains the original probe, the frozen task and judge manifest, `replay.jsonl`, `judge.jsonl`, timing and cost summaries, and the public SDK smoke build.

### Remove the completion call from extraction

Ordinary extraction and the `map` fallback now use one structured generation call and a neutral result log. The SDK still returns the requested data with usage and cache metadata. The optional Decider verdict stays in the `judge` and `pick` modes. If the verdict is unavailable, return the extraction and honor the operation deadline. The `pick` gate still checks copied data before accepting it.

The public SDK comparison used three local controls and three live reference or pricing pages, two rounds per path. Timings include snapshot capture and exclude navigation. Luna reported no cache reads. The p95 equals the slowest run at this sample size.

| Live path                      | Passed |     p50 / p95 | Luna calls |
| ------------------------------ | -----: | ------------: | ---------: |
| Previous Luna                  |  10/12 | 4.24 / 5.13 s |         24 |
| Single-call Luna               |  10/12 | 1.74 / 2.37 s |         12 |
| Decider with raw Luna fallback |  10/12 | 2.00 / 3.14 s |          6 |

Every arm returned uppercase Neon plan names where the existing grader expected title case. The grader stayed fixed. This live run covers the removal in the SDK. The wider fresh-page comparison remains on the roadmap.

Archive `runs/plan-validation/single-call-cleanup-20261115T112309Z/` contains both historical probe sources, the pre-cleanup patch and base revision, and the live runs. The active [probe](../compactPageProbe.ts) compares raw Luna, compact Luna, and Decider with compact Luna fallback using the current single-call implementation.

The active probe finished 144 runs on the 16 frozen pages. Each path ran three times per page. All direct accepts passed. Provider cache covered over 99% of reported Luna input in all three arms.

| Single-call replay path          | Passed |     p50 / p95 | Uncached cost per 1,000 | Cost with reported cache per 1,000 |
| -------------------------------- | -----: | ------------: | ----------------------: | ---------------------------------: |
| Luna, raw                        |  44/48 | 2.02 / 3.13 s |                  $1.561 |                             $0.184 |
| Luna, compact                    |  46/48 | 1.73 / 3.24 s |                  $0.863 |                             $0.114 |
| Decider + Luna, compact fallback |  45/48 | 2.21 / 4.97 s |                  $0.618 |                             $0.142 |

Compaction alone cut uncached Luna cost by 45%. Adding Decider saved a further 28% at uncached rates and cost more at the cache hit rates observed here. Compact Luna is the next live comparator for the cascade. See `compact-replay/` in the same archive.
