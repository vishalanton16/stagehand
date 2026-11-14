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

Both approaches recovered all four Kubernetes and WebAssembly answers directly. The appended version caused additional fallbacks on MDN and lost one RockAuto fallback result in the broader replay. No direct accepts failed in these comparisons. The retry result is a targeted development result. A new set should include sources that are absent from both shortlists. This will measure the extra round trip and catch bad accepts when the first abstention was correct. Keep both variants in replay.

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
