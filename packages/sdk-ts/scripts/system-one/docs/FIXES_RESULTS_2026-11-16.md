# Fixes and remeasurement, November 16

The fixed decision path passed 240/246 frozen extractions versus 237/246 for the preserved
implementation and 231/246 for ordinary Luna. Wrong direct accepts fell from three to zero on
this corpus. Fallbacks increased from 51 to 57. These are regression results, not a general
correctness guarantee.

The [aggregate](../results/bench-fixes-2026-11-16.json) records results, paired outcomes, source
archives, usage and raw-result hashes. The [initial comparison](./BENCH_COMPARISON_2026-11-16.md)
remains unchanged apart from its follow-up pointer. No task-specific production branches were added.

## Changes retained

- Scalar mapping and its independent reader now see the same bounded paragraph evidence, up to
  1,500 characters. Named text leaves have the same size allowance as joined inline text. Previously,
  180/300-character previews hid precise values later in paragraphs.
- Numeric extraction prefers an explicitly stated precise value over an approximate summary,
  while respecting a requested source. String-only extraction prompts remain byte-identical.
- Ordinary action inference returns no action for informational questions without a requested
  browser interaction. Polite interaction requests remain allowed.
- Observation shares membership rules in request state instead of repeating the full rules per
  candidate. Candidate evidence, completeness checks and thresholds remain intact.
- The eval initializer omits its generic no-clarification system prompt. Structured SDK operations
  cannot ask an operator a question; that prompt unnecessarily forced decision observation into
  fallback. Genuine custom system instructions still use ordinary observation.
- The comparison runner reuses Chrome's initial page. Its extra blank page had broken tasks using
  `pages[0]`. Cached fixtures restore their original base URL after loading, including SingleFile
  documents without an explicit `<head>`.
- `vantechjournal` waits up to ten seconds for the same expected URL. The previous grader read it
  before asynchronous navigation completed. The required destination did not change.

## Final baseline versus decisions

Baseline is ordinary Stagehand with `openai/gpt-6-luna`. Decisions use `pplx-decider-v1.3` with the
same Luna fallback. Only the operation under test uses decisions; helpers use ordinary Stagehand.

Times are seconds, baseline / decision. Live operation times include snapshots, checks and fallback.
Frozen replay excludes browser capture and live evidence revalidation. Failed calls remain in the
nearest-rank percentiles.

| Workload                                         | Baseline passes | Decision passes | Operation p50 | Operation p95 |
| ------------------------------------------------ | --------------: | --------------: | ------------: | ------------: |
| Corrected live act suite, 40 tasks once          |           38/40 |           39/40 |   2.75 / 2.75 |   6.65 / 5.56 |
| Cached-page SDK extraction, 19 tasks three times |           54/57 |           57/57 |   2.62 / 1.51 |  19.22 / 6.87 |
| Frozen extraction, 82 tasks three times          |         231/246 |         240/246 |   2.73 / 1.38 |  11.30 / 4.79 |
| Public SDK observe, 11 tasks twice               |           22/22 |           22/22 |   1.45 / 0.65 |   3.19 / 2.33 |
| Frozen observe, 51 tasks three times             |         152/153 |         153/153 |   1.73 / 0.73 |   7.83 / 6.53 |

Live act contains 54 action calls per arm. The shared failure was `bidnet`, which served a 403 page.
Luna additionally missed `login`. No final act or cached-extraction snapshot showed a Vercel
checkpoint. Live observe had no drift or errors and used fallback twice in 22 decision calls.

Cached extraction's three earlier decision failures were fixture-origin mismatches. Their recovery
is a measurement fix, not evidence that the mapper improved on three web tasks. Luna's remaining
three failures omitted public-notice rows.

## Preserved implementation versus fixes

The old source was archived before editing. The final extraction run interleaved old decisions,
ordinary Luna and fixed decisions on identical snapshots with rotating arm order.

| Frozen extraction                       | Preserved decisions | Fixed decisions |
| --------------------------------------- | ------------------: | --------------: |
| Passed                                  |             237/246 |         240/246 |
| Wrong direct accepts                    |                   3 |               0 |
| Direct returns                          |                 195 |             189 |
| Fallbacks                               |                  51 |              57 |
| Decision requests                       |                 516 |             516 |
| p50 / p95                               |       1.39 / 6.81 s |   1.38 / 4.79 s |
| Estimated uncached USD per 1,000 trials |              $0.851 |          $0.870 |

Four paired trials passed only after the fixes; one passed only before. The three NIST trials now
expose the precise paragraph value to the second reader, detect disagreement with the approximate
table, and recover through Luna. This removes the old silent acceptance of 273 K against the
frozen expected 273.15 K. The task remains ambiguous without a source/precision policy.

The other changed outcomes were a coolant-list recovery and a domain-list failure. They should not
be counted as established code improvements. A fixed-reply probe confirms identical before/after
requests and handling for the domain-list fallback. Its failure remains scored.

The six fixed-path failures were three GitHub qualifier copies, two phone/fax label-format errors,
and one domain-list copy. All used fallback. GitHub's accessibility text contains an extra space
inside an identifier; exact rendered-DOM evidence needs separate capture work. No whitespace
guessing or answer-specific repair was added.

In the informational-action control, both old arms performed input in 2/2 trials each. Both fixed
arms refused with zero returned actions in 6/6 trials each across targeted and full runs.

The first new full act run retained the original navigation grader: Luna passed 113/120 and
decisions 112/120. Besides the shared 403 and timing failures, Luna missed one self-heal case;
decisions had one active-tab registration timeout and one cross-frame click failure. The corrected
navigation task then passed 3/3 per arm, followed by the separate corrected full-suite run above.
Do not pool these grader versions or discard the intermittent failures.

## Cost and observe tradeoffs

Estimates use the repository's existing USD-per-million assumptions: Luna input $0.10, cache reads
$0.01, output $0.50; Decider input $0.02. These are not verified invoice prices. Amounts below are
per 1,000 evaluated task trials and include only the operation under test. Act tasks may call it
multiple times. Browser costs are excluded.

| Workload                   | Uncached baseline / decision | With reported cache reads, baseline / decision |
| -------------------------- | ---------------------------: | ---------------------------------------------: |
| Corrected live act         |              $0.792 / $0.401 |                                $0.700 / $0.319 |
| Cached-page SDK extraction |              $1.054 / $0.372 |                                $1.011 / $0.365 |
| Frozen extraction          |              $2.316 / $0.870 |                                $1.053 / $0.347 |
| Public SDK observe         |              $0.107 / $0.052 |                                $0.081 / $0.048 |
| Frozen observe             |              $2.114 / $2.064 |                                $0.347 / $0.429 |

The scalar safety fix costs about 2.3% more at uncached rates than preserved decisions. Its
reported-cache estimate was $0.347 versus $0.214 before, with different cache-read totals. Prompt
changes invalidate warm cache inputs; do not treat that difference as a stable invoice forecast.

Shared observe instructions preserved 153/153 against the old observer's 153/153. Combined input
fell from 4,703,940 to 4,491,108 tokens. Uncached estimated cost fell only 0.3%; reported-cache cost
fell 6.6%. Fallbacks rose from 21 to 27. Matched p50 was 0.69 / 0.73 seconds and p95 was
5.98 / 6.53 seconds. This is a small input reduction, not a general observe cost fix. With cache
reads, it still cost about 24% more than Luna on the frozen workload, despite costing less on the
small live SDK set.

Two trials were not retained:

- A staged observer skipped membership questions for single targets but needed a second request
  for sets. It preserved all scores and reduced cost, but p50 rose from 0.72 to 0.96 seconds.
- Applying precision guidance to every schema perturbed large string-list fallback. The final
  numeric-schema gate restores byte-identical string-only prompts. All scored trial outputs remain.

These are previously used regression sets. Repeated inputs and provider cache reads were common.
Timing across sessions, or tails from the small live sets, do not establish general latency gains.

## Checks and evidence

The final implementation passed 1,322 extension/understudy tests, with three skips and nine todos,
plus five eval-initializer tests. Extension/eval TypeScript checks, builds, scoped format/lint and
Python analysis checks passed. Lint retains the repository's eval compiler-option warning.

SDK controls passed 25/25, including genuine custom instructions, scope, frames, shadow DOM,
variables and key-only behavior. Both scalar SDK arms passed 6/6 new controls: precise values late
in paragraphs and explicit requests for the approximate table value.

Raw directories are under `vendor-repos/system-one-corpus/runs/`:

| Evidence                                    | Directory                                                        |
| ------------------------------------------- | ---------------------------------------------------------------- |
| Before/after source archives and manifests  | `fixes-2026-11-16/`                                              |
| Final frozen extraction, 738 scored trials  | `archive/f178992a-ee7f-4a18-95f6-59d331864155/`                  |
| Final cached-page SDK extraction            | `fixes-2026-11-16/extract-cached-final/`                         |
| Original-grader and corrected act suites    | `fixes-2026-11-16/action-full/`, `action-corrected-full/`        |
| Corrected navigation follow-up              | `fixes-2026-11-16/vantech-corrected/`                            |
| Retained observe trial and SDK confirmation | `fixes-2026-11-16/observe-shared/`, `observe-sdk-live/`          |
| Observe and scalar SDK controls             | `fixes-2026-11-16/observe-sdk-controls/`, `precision-sdk-final/` |
| Rejected staged observer                    | `fixes-2026-11-16/observe-staged/`                               |
| Rejected unscoped precision guidance        | `archive/23db6475-e766-4509-964c-c173f3671537/`                  |

`tld-request-equivalence.ts` and its JSON result record the fixed-reply probe. Navigation probes and
old/new informational-action controls are retained alongside the manifests. Raw evidence remains
Git-ignored and must be copied separately when moving machines.

For reproduction, use the original extraction task selection and unchanged frozen observe labels
from the initial comparison. Select extraction arms `before-decider,runtime-luna,runtime-decider`
and set `BENCH_BEFORE_ROOT` to the preserved `before/` source directory. SDK runner output paths
must be new. The corrected full act run uses:

```sh
BENCH_OPERATIONS=act BENCH_ROUNDS=1 BENCH_CONCURRENCY=2 node --env-file=.env --import tsx packages/sdk-ts/scripts/system-one/benchComparison.ts vendor-repos/system-one-corpus/runs/new-corrected-act
```

No release, commit, push or PR was created.
