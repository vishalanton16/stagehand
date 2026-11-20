# Offline act retrieval experiment

## Protocol fixed before scoring

The baseline is the click and fill candidate shortlist from `actionPlans.ts` at `93b9d913281cd361a296f3126712827700215b53`. Run the production visibility, enabled, role and editability filters and retain its lexical scores. Measure the score order that determines shortlist membership. Production presents the resulting shortlist to the provider in DOM order.

Compare one alternative. Within each equal-score band, take one candidate from each repeated record before taking a second from any record. Detect records with the nearest qualifying XPath ancestor of type `li`, `tr` or `article`. A qualifying ancestor has at least three sibling instances with eligible candidates. Preserve score order across bands and DOM order within each pass. Ungrouped candidates participate in the first pass. The hypothesis is that tie-breaking can buy coverage at a fixed budget without overriding stronger lexical evidence.

The archive paths below are relative to the supplied `vendor-repos` directory. Each arm uses the same snapshot, instruction, action-kind view and independent labels. Verify the files against their capture manifests.

| Split | Frozen inputs | Scoring |
| --- | --- | --- |
| Act development | `system-one-corpus/runs/act/dev-capture-20261115` | All available click and fill labels |
| Act confirmation 1 | `system-one-corpus/runs/act/confirmation-capture-20261115` | Same |
| Act confirmation 2 | `system-one-corpus/runs/act/confirmation2-final-capture-20261115` | Same |
| Books record stress | `observe-improvement/tuning-capture`, Books page | Every labeled click query with an instruction, plus the absence control |
| Shop record stress | `observe-improvement/validation-capture`, Shop page | Same |

The three Act splits have different capture sites. Prior experiments used all these archives, so confirmation here means confirmation for this offline comparison. Report the two Observe pages separately. Their gold labels cover individual DOM targets and sets of targets, which lets us stress the Act ranker at small budgets. The Books site also appears in Act confirmation 1. The Act archive has one unavailable query and one select-option query outside the supported action views. Exclude both and report them.

Report target recall at 1, 5, 10 and 30 and mean reciprocal rank of the first gold target, truncated at 30. For Act, any archived gold ID satisfies the query. For Observe-derived tests, count required DOM targets using canonical paths so multiple AX IDs for the same element count once. Measure wrong-record rank 1 for single-target queries where all eligible gold targets resolve to one inferred record. Count a wrong record when the top candidate belongs to a sibling record. Also count queries where a cutoff keeps some but omits other positive-score candidates with the same score, role and name across sibling records. Use the real absent and disabled-target labels as negative controls and report positive-score rank-1 candidates on those queries. Assert that the alternative preserves score bands, leaves ungrouped ranks unchanged on an ungrouped fixture, and advances a later record on a tied fixture.

These metrics describe candidates only. Act method and fill argument generation, provider selection and abstention, browser execution, cost and latency are outside the measurement.
