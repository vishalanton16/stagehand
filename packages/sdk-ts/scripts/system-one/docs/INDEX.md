# System One docs

Status and handoff for experimental System One extraction (`extract: "map"`). The runtime uses one decision model with an LLM fallback.

| Doc                                  | Purpose                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| [REVIEW.md](./REVIEW.md)             | Review of the **uncommitted** production wiring on top of commit `632789220` |
| [NEXT_STEPS.md](./NEXT_STEPS.md)     | Ordered engineering tasks with done conditions                               |
| [EVALUATION.md](./EVALUATION.md)     | How to measure fairly (held-outs, metrics, what not to claim)                |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | How the pipeline works and where the code lives                              |
| [ROADMAP.md](./ROADMAP.md)           | Product phases from experiment → default                                     |
| [DIRECTIONS.md](./DIRECTIONS.md)     | Alternatives and experiments that are deliberately _not_ the product default |

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
| 9. Prepare a reviewable stack         | Pending | Per the workspace request, changes are unstaged at `632789220`. The suggested split is in [NEXT_STEPS.md](./NEXT_STEPS.md#9-split-into-a-reviewable-stack).                                                          |

## Measurements

| Comparison                  | Result                                                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seen replay, before → after | Passes 96/98 → 96/98, correct direct accepts 78 → 77, fallbacks 18 → 19, wrong accepts 2 → 2. Replay p95 14.52 s → 11.32 s.                                           |
| Fresh replay                | Decider 10/12 with 4 fallbacks, Flash 10/12 with 6 fallbacks, Luna 8/12 with standard instructions and 10/12 in a separately scheduled run with absence instructions. |
| Live SDK                    | Decider 6/6 at 6.02 s p50 and 10.86 s p95. Luna 4/6 at 3.95 s p50 and 4.48 s p95. Both timings include navigation and snapshot capture.                               |

The MDN task returned 38 of 63 requested status codes and passed the runtime checks both times. The NIST grader required 273.15 K from the prose, and both decision models returned 273 K from the table. The frozen scores preserve that ambiguity. On the real-page subset, Luna returned an empty string for an absent DOI in both RFC runs. The IANA task drove the upper latency tail in fresh replay. [Full results and replay archive IDs](../README.md#plan-validation)

`extract: "map"` remains opt-in. The open release gates are list completeness, fewer round trips without added wrong accepts, a controlled comparison of the scalar checks, and an independent confirmation on another fresh set. The saved runs and detailed comparisons are linked from the [README](../README.md#plan-validation).
