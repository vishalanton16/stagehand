# Offline act retrieval experiment

## Protocol fixed before scoring

The baseline is the click and fill candidate shortlist from `actionPlans.ts` at `93b9d913281cd361a296f3126712827700215b53`. Run the production visibility, enabled, role and editability filters and retain its lexical scores. Measure the score order that determines shortlist membership. Production presents the resulting shortlist to the provider in DOM order.

Compare one alternative. Within each equal-score band, take one candidate from each repeated record before taking a second from any record. Detect records with the nearest qualifying XPath ancestor of type `li`, `tr` or `article`. A qualifying ancestor has at least three sibling instances with eligible candidates. Preserve score order across bands and DOM order within each pass. Ungrouped candidates participate in the first pass. The hypothesis is that tie-breaking can buy coverage at a fixed budget without overriding stronger lexical evidence.

The archive paths below are relative to the supplied `vendor-repos` directory. Each arm uses the same snapshot, instruction, action-kind view and independent labels. Verify the files against their capture manifests.

| Split               | Frozen inputs                                                     | Scoring                                                                 |
| ------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Act development     | `system-one-corpus/runs/act/dev-capture-20261115`                 | All available click and fill labels                                     |
| Act confirmation 1  | `system-one-corpus/runs/act/confirmation-capture-20261115`        | Same                                                                    |
| Act confirmation 2  | `system-one-corpus/runs/act/confirmation2-final-capture-20261115` | Same                                                                    |
| Books record stress | `observe-improvement/tuning-capture`, Books page                  | Every labeled click query with an instruction, plus the absence control |
| Shop record stress  | `observe-improvement/validation-capture`, Shop page               | Same                                                                    |

The three Act splits have different capture sites. Prior experiments used all these archives, so confirmation here means confirmation for this offline comparison. Report the two Observe pages separately. Their gold labels cover individual DOM targets and sets of targets, which lets us stress the Act ranker at small budgets. The Books site also appears in Act confirmation 1. The Act archive has one unavailable query and one select-option query outside the supported action views. Exclude both and report them.

Report target recall at 1, 5, 10 and 30 and mean reciprocal rank of the first gold target, truncated at 30. For Act, any archived gold ID satisfies the query. For Observe-derived tests, count required DOM targets using canonical paths so multiple AX IDs for the same element count once. Measure wrong-record rank 1 for single-target queries where all eligible gold targets resolve to one inferred record. Count a wrong record when the top candidate belongs to a sibling record. Also count queries where a cutoff keeps some but omits other positive-score candidates with the same score, role and name across sibling records. Use the real absent and disabled-target labels as negative controls and report positive-score rank-1 candidates on those queries. Assert that the alternative preserves score bands, leaves ungrouped ranks unchanged on an ungrouped fixture, and advances a later record on a tied fixture.

These metrics describe candidates only. Act method and fill argument generation, provider selection and abstention, browser execution, cost and latency are outside the measurement.

## Reproduce

Run from the repository root with Bun. The replay checks the production source against the baseline commit and verifies each snapshot and label file against its archive manifest. It emits per-query metrics and split summaries as JSON.

```sh
vendor_repos=/Users/vishal/Developer/personal/forks/stagehand/vendor-repos
bun packages/sdk-ts/scripts/system-one-variants/replay.ts "$vendor_repos" \
  > /tmp/stagehand-system-one-variants.json
jq '.results[] | del(.rows)' /tmp/stagehand-system-one-variants.json
```

Label provenance is in `experimental-decisions/packages/sdk-ts/scripts/system-one/act/capture.ts` and `observe-improvement/capture.ts` under the archive root. The Act capture matches hand-authored CSS selectors to snapshot node IDs. The Observe capture also records canonical DOM paths and required targets. The reranker receives only the snapshot, instruction and action kind.

## Offline results

Each pair shows production → record-diverse. Recall averages the fraction of required targets retrieved per query. Each Act query requires one target. An observed rank beyond 30 contributes zero to MRR@30.

| Split              | Positive / negative queries | Recall@1 | Recall@5 | Recall@10 |     Recall@30 |      MRR@30 |
| ------------------ | --------------------------: | -------: | -------: | --------: | ------------: | ----------: |
| Act development    |                      10 / 5 |    60.0% |     100% |      100% |          100% | .737 → .753 |
| Act confirmation 1 |                       5 / 3 |    60.0% |     100% |      100% |          100% |        .733 |
| Act confirmation 2 |                       6 / 3 |    33.3% |    83.3% |     83.3% |          100% |        .487 |
| Books stress       |                       3 / 1 |     1.7% |    41.7% |     50.0% |         66.7% |        .444 |
| Shop stress        |                       3 / 1 |    35.4% |    43.8% |     54.2% | 72.9% → 83.3% |        .681 |

Both arms retrieved a gold target at production's cutoff for all 21 positive Act queries. Development MRR moved because the Python tutorial link rose from rank 3 to rank 2. The highest-ranked candidate remained in a different record. The alternative preserves rank 1 by construction. Across Act, one of seven evaluable queries had a wrong sibling record at rank 1 in both arms.

The Shop product-link query gained five required targets at rank 30, from 3/16 to 8/16. The first correct link stayed at rank 23. All 16 links were eligible, so the gain came from allocating the same budget across more records. The Books title-link query still retrieved 0/20 at rank 30 with the first match at rank 56. All 20 were eligible, but the ranker put 130 of 134 candidates in one score band and earlier candidates still filled the budget. The Django download query stayed at rank 19. Its best gold score was 4 against the leading score of 7, a gap this tie-breaker cannot close.

The repeated Books basket controls were the only positive query whose equal-score, same-name sibling cohort was split by a measured cutoff. Both arms split it at 1, 5 and 10 and included it at 30. They also gave a positive lexical score to the first candidate on two of 13 absent or disabled-target queries. Both were archived absent-target cases. A positive score therefore cannot establish existence. This experiment measured neither abstention nor wrong accepts.

On these archives, tie diversification recovers some repeated targets around the shortlist cutoff. The confirmation splits show no improvement for single-target Act queries. The catalog evidence comes from two sites, and the heuristic can group navigation list items as records.

## Live provider measurements

No live provider calls were made for this experiment. The offline results do not estimate provider accuracy, fallback, latency or cost.
