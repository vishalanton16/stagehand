# Decision-model research for Stagehand extraction

Reviewed November 15, 2026. The proposed experiments use the captured browser state as their source and retain one decision model plus the configured LLM fallback.

| Source                                                                                                                                                                                                                                       | Finding                                                                                                                                                                                                                                                                   | Implication for Stagehand                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [TypeSafe's architecture post](https://typesafe.ai/blog/dont-call-it-a-decision-model), [fan-out pattern](https://docs.typesafe.ai/patterns/fan-out), [model docs](https://docs.typesafe.ai/models)                                          | Jev can evaluate separate questions against common state in parallel. Its fan-out example shares a small input across branches. Jev has both a total request limit and a per-question context limit.                                                                      | Batch questions that reuse small, already relevant evidence. Apply exact scope, count, and schema rules in code where possible.                                                                                                      |
| [Perplexity v1.3 research](https://www.perplexity.ai/sk/hub/blog/perplexity-decider), [Decisions docs](https://docs.perplexity.ai/docs/decisions/quickstart)                                                                                 | v1.3 questions can still influence one another through shared state. The article discusses a fully cacheable attention variant as a design alternative. The hosted documentation explains that oversize question groups can run sequentially and bill shared state again. | Freeze request grouping and pin model IDs for comparisons. Measure input size and split behavior along with HTTP calls. Benchmark Locate independently.                                                                              |
| [Cloudflare Clef](https://blog.cloudflare.com/clef-decision-models/), [Clairic research](https://blog.cloudflare.com/clairic-extraction-model/), [extraction docs](https://developers.cloudflare.com/workers-ai/concepts/extraction-models/) | Clef supports cross-field attention. Clairic has typed values, source spans for text, and a probability of absence for scalar fields. Its numeric answers can include calculations.                                                                                       | Test compact choice prompts separately per provider. Compare Clairic with Locate on identical, bounded evidence. For copy-only requests, validate a returned value against its record and field before accepting it.                 |
| [Parallel's Jev benchmark](https://parallel.ai/blog/testing-jev), [Decisions launch](https://parallel.ai/blog/decisions-api), [API docs](https://docs.parallel.ai/decisions/decisions-quickstart)                                            | Jev was competitive with one internal reranker in Parallel's tests and weaker on broad label classification. Parallel's own API retrieves web evidence and returns citations with its decisions.                                                                          | Measure retrieval and ranking separately. Borrow the evidence-first design by attaching snapshot node IDs to selected values. An API that retrieves external evidence answers a different question from browser snapshot extraction. |
| [P(Yes) research](https://arxiv.org/abs/2610.25474)                                                                                                                                                                                          | Searching over yes/no scores improved joint accuracy on logic puzzles. The paper does not evaluate webpage extraction or establish an extraction latency benefit.                                                                                                         | Try inexpensive code checks across several candidate plans from an existing response before considering extra model calls.                                                                                                           |

## First experiment

Measure whether the right evidence reaches the first request before changing the production schedule. In the eight-list-page replay, speculative mapping picked the right group in 6 of 16 runs. Bundling the top two candidates still covered only 6 of 16 selected groups, and increased mean input tokens from 3,312 to 7,944. Those runs measure overlap with the model's eventual selection. They do not establish whether the ranker found the correct group.

1. On development pages, label the source container, representative rows, and field sources using the frozen snapshot. Include split sections, repeated headers, look-alike tables, and inverse units. Measure both **candidate recall**, which asks whether a valid group was generated at all, and **recall at 1 and 2**, which ask whether it ranked high enough. Treat several candidates as valid when they contain equivalent evidence for the request.
2. Compare the current ranker with a ranker that uses schema field coverage, table captions and headings, and preserved container boundaries. Compare both with an oracle that supplies the labeled group. The oracle tells us whether a better ranker could save the round trip or field mapping would still fail.
3. Test one compact request only for a candidate with adequate evidence. The model can select field slots and explicitly reject the group. Code checks selected slots, scope, and row coverage before copying. Other cases use the existing sequential implementation. Compare same-model request packing with fixed state and question text before expanding the experiment across providers.
4. Check optional scalar presence and ambiguity on the same short evidence using copy, Locate, and Clairic as separate arms. Include absent fields, explicit zeros, numbers in titles, opposite unit directions, and numbers from adjacent records. Match returned spans to the source node where the adapter exposes offsets. Treat a syntactically valid answer or a high confidence score as insufficient on its own.

Freeze a new set after choosing the approach on development pages. Run matched live SDK comparisons with pinned provider model IDs where available, rotated order, and the same pages across sessions. Report accuracy, wrong accepts, fallback rate, extraction p50/p95, and completed requests and input tokens. Report direct and fallback timings separately. Capture enough distinct pages and observations to make p95 more informative than the slowest of a handful of runs. Promote only if the paired comparison preserves correctness and improves or matches Luna at p95.

The direct Perplexity docs list the v1.3 model IDs. The Context7 extract still surfaced v1.2 in its model listing. Use the direct [Perplexity model docs](https://docs.perplexity.ai/docs/decisions/quickstart#models) for the next run's IDs. Alias-based historical logs alone do not identify which version served each request.

## Evidence ranking and one-request trials

The offline audit uses 13 frozen development snapshots. Labels specify the first and last source-node IDs and the row count. A covering group can include extra rows. An exact group matches both boundaries and the count. This is a container-level audit. It does not validate intermediate rows or individual fields. Some tasks, such as the highest mountains, select a subset of the labeled source group.

| Audit before the PostgreSQL fix | Current ranker | Schema-aware ranker |
| ------------------------------- | -------------: | ------------------: |
| Covering group generated        |          12/13 |               12/13 |
| Covering group first            |           6/13 |                9/13 |
| Covering group in top two       |           6/13 |               11/13 |
| Exact group generated           |          11/13 |               11/13 |
| Exact group first               |           3/13 |                7/13 |
| Exact group in top two          |           4/13 |               10/13 |

The IANA text document stores its domain lines in one text node, so neither ranker has a record group. Web Scraper has a covering group with six rows across two tables. Its first three rows require scope filtering. The ranking experiment scores scope labels and field coverage alongside sample overlap and group size.

Run the audit locally without model credentials:

```sh
node --import tsx packages/sdk-ts/scripts/system-one/groupAudit.ts
```

### Paired frozen replay

Twelve list pages ran twice per arm. The decision arms used pinned Decider v1.3. The oracle received the labeled source-group ID and skipped group selection. It still had to map fields, resolve scope, and pass runtime checks.

| Arm                             | Passed | Wrong accepts | Fallbacks |      p50 / p95 | Direct p50 / p95 | Mean input tokens | Est. USD / 1k |
| ------------------------------- | -----: | ------------: | --------: | -------------: | ---------------: | ----------------: | ------------: |
| Sequential Decider              |  24/24 |             0 |         3 |  1.09 / 4.77 s |    1.07 / 2.37 s |             4,305 |        $0.111 |
| Schema-aware speculation        |  24/24 |             0 |         6 | 1.14 / 11.22 s |    0.62 / 2.37 s |             5,801 |        $0.157 |
| Labeled group + Decider mapping |  24/24 |             0 |         2 |  0.51 / 5.04 s |    0.50 / 1.77 s |             1,725 |        $0.040 |
| Luna                            |  24/24 |             — |         — | 4.98 / 12.43 s |                — |            27,759 |        $0.631 |

Schema-aware speculation reused 16 of its 24 early calls. It produced more disagreements on nginx and MDN. This trial does not support shipping it. Replay archive: `fb376200-5853-452b-8cb9-62e0817ca9e1`.

A second paired replay separated the ranker from scheduling. It also tested a one-request fit check plus field mapping on the top-ranked candidate. At the tested 0.9 threshold, the fit check accepted zero candidates. Its highest observed score was 0.775.

| Arm                                   | Passed | Wrong accepts | Fallbacks | Mean calls |     p50 / p95 | Est. USD / 1k |
| ------------------------------------- | -----: | ------------: | --------: | ---------: | ------------: | ------------: |
| Sequential Decider                    |  24/24 |             0 |         2 |       2.33 | 1.06 / 5.07 s |        $0.070 |
| Sequential Decider with schema ranker |  24/24 |             0 |         5 |       2.58 | 1.11 / 6.15 s |        $0.109 |
| Fit check plus field mapping          |  24/24 |             0 |         5 |       3.58 | 1.94 / 7.29 s |        $0.136 |

The saved replay retains the fit-check prototype and traces. That path was removed from the working tree. Replay archive: `0c155ff5-c15f-480b-b783-ecc504770318`.

### PostgreSQL source mapping

The oracle had all nine lesson rows but selected no field. The list was nested under a description-list definition, so the mapper lacked the chapter label. The term also included a dotted section number, and the mapper had no separate title option. Nested terms now inherit the enclosing description label, and the model can select the title span after the dotted prefix. The whole label remains an option.

On PostgreSQL, sequential Decider went from two fallbacks to two direct passes. Both oracle runs also passed directly after the fix. This was tested in a separate provider session on the same snapshot. See replay archive `7edd012d-a039-4ced-afa5-0495b53a6b41`.

### Verification after the source-mapping fix

Thirty-five known list tasks ran twice per arm on frozen snapshots. These runs include model time and replay overhead. They do not include network navigation or a browser snapshot.

| Paired replay                | Passed | Wrong accepts | Fallbacks |      p50 / p95 | Mean input / output tokens | Est. USD / 1k |
| ---------------------------- | -----: | ------------: | --------: | -------------: | -------------------------: | ------------: |
| Decider v1.3 + Luna fallback |  70/70 |             0 |         8 | 1.06 / 10.60 s |                6,614 / 233 |        $0.209 |
| Luna                         |  70/70 |             — |         — | 6.07 / 38.89 s |               24,653 / 910 |        $1.392 |

Decider's direct p50/p95 was 1.04/2.15 s. The eight fallbacks took 7.28/44.48 s at p50/p95. Estimates use provider-reported tokens and cache reads at the configured rates. Prices are from [Perplexity](https://docs.perplexity.ai/docs/decisions/quickstart#models) and [Vercel AI Gateway](https://ai-gateway.vercel.sh/v1/models). Replay archive: `adeb7221-45fa-4611-bdb1-96b9c5f769b3`.

The rebuilt SDK also passed a live check on PostgreSQL, HTML tables, curl, Rust, and nginx. Each page ran twice with rotated model order. The Decider arm used the latest alias. With ten observations per arm, p95 is the maximum.

| Public SDK              | Passed | Fallbacks | Extraction p50 / p95 | End-to-end p50 / p95 | Mean input tokens |
| ----------------------- | -----: | --------: | -------------------: | -------------------: | ----------------: |
| Decider + Luna fallback |  10/10 |         0 |        1.21 / 1.85 s |        1.86 / 8.94 s |             2,227 |
| Luna                    |  10/10 |         — |       4.39 / 10.99 s |       4.61 / 11.03 s |            37,569 |

Live results: `runs/plan-validation/stagehand-source-mapping-live.jsonl`.

A subsequent change stops field mapping when the group check has already rejected a standalone list. In a focused replay, all ten runs passed. The four rejected groups used one Decision API request each before falling back, down from two for those cases in the larger replay. This change is covered by the focused replay, separately from the preceding live timing. Replay archive: `fb080a86-d232-484b-910d-f29911c62d9e`.

Next, compare a single candidate-selection call followed by grounded mapping against the current dual group check. Keep an abstention path and include pages where more than one table or section looks plausible. Freeze fresh tasks before scoring and include both direct and fallback cases in the live comparison.
