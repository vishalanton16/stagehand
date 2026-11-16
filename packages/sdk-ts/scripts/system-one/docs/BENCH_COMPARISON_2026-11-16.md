# Baseline versus current decisions, November 16

Follow-up: [fixes and remeasurement](./FIXES_RESULTS_2026-11-16.md). The numbers below describe the original measured implementation and harness.

Current decisions performed best on extraction in these workloads. Observation preserved the frozen
scores and reduced median latency, but did not materially reduce uncached cost. Act reduced model
cost with little change in median action latency. Its task-level p95 increased.

Baseline is ordinary Stagehand using `openai/gpt-6-luna`. Decisions use the current production
implementation, pinned `pplx-decider-v1.3`, and the same Luna fallback. This compares the retained
architecture against ordinary Stagehand, rather than comparing two historical decision policies.

The [aggregate JSON](../results/bench-comparison-2026-11-16.json) contains exact totals, usage,
paired failures, raw result hashes and manifest hashes. These are existing regression workloads,
not fresh held-out evidence. Repeated trials do not create independent tasks.

## Scores and latency

Times are seconds, baseline first. Live operation times include SDK snapshots, decision checks
and fallback. Frozen replay excludes navigation, browser capture and live evidence revalidation.
Percentiles use nearest rank and include failed calls.

| Workload                                          |         Trials per arm | Baseline passes | Decision passes | Operation p50, baseline / decision | Operation p95, baseline / decision |
| ------------------------------------------------- | ---------------------: | --------------: | --------------: | ---------------------------------: | ---------------------------------: |
| Existing live act suite                           |    40 tasks, one round |           34/40 |           35/40 |                        1.79 / 1.72 |                        5.48 / 4.43 |
| Existing extract graders, cached HTML through SDK | 19 tasks, three rounds |           52/57 |           54/57 |                        2.45 / 1.60 |                       12.85 / 6.63 |
| All available frozen extraction tasks             | 82 tasks, three rounds |         233/246 |         240/246 |                        2.46 / 1.26 |                       12.30 / 4.80 |
| Existing labeled observation snapshots            | 51 tasks, three rounds |         153/153 |         153/153 |                        1.73 / 0.78 |                        7.86 / 7.06 |

Act's operation distribution contains 54 action calls per arm across 40 tasks. Task-level latency
includes browser creation, navigation, helpers, final capture and cleanup. Act task p50 was
4.69 / 4.85 seconds and p95 was 9.73 / 11.07 seconds. Lower action p95 did not translate into lower
workflow p95. Cached extraction task p50 was 3.71 / 2.47 seconds and p95 was 13.46 / 9.26 seconds.

## Routing and correctness

| Decision workload      | Direct calls without fallback or exception | Fallback calls | Completed decision requests |
| ---------------------- | -----------------------------------------: | -------------: | --------------------------: |
| Live act               |                                      18/54 |   36/54, 66.7% |                          24 |
| Cached HTML extraction |                                      45/57 |   12/57, 21.1% |                         114 |
| Frozen extraction      |                                    195/246 |  51/246, 20.7% |                         516 |
| Frozen observe         |                                    132/153 |  21/153, 13.7% |                         162 |

Direct routing does not establish correctness. Frozen extraction accepted 192 correct results
directly and three wrong results directly. All three wrong accepts were `hold5_nist_temp`, whose
table says 273 K while prose and the frozen grader require 273.15 K. Keep the frozen failures.
Fallback passed 48/51. Its three failures were `hold7_github_repo_qualifiers`.

Extraction had seven paired decision-only passes and no baseline-only passes. Recoveries were
`gomod_stars_absent` three times, `hold5_rfc_absence` twice, `hold6_economics_school` once and
`hold5_tld_list` once. Baseline and decisions shared six failures. Missing-value behavior differs
between ordinary extraction and the decision cascade's guarded fallback, so these gains measure
the complete architecture, including its fallback policy.

Act had one decision-only pass, `login`, and no baseline-only passes. Both failed `bidnet`,
`multi_tab`, `nonsense_action`, `tab_handling` and `vantechjournal`. The nonsense task's success-only
grader does not prove safe refusal; both arms clicked a control after the unrelated question.
Act fell back 35 times for `action_plan_abstained` and once for a covered target.

Observation had zero wrong direct accepts on these labels. Its 21 fallbacks were 12
`uncertain_set_member` and nine `unrepresented_candidates:2766`. The 51 tasks combine existing
development and confirmation captures with their retained labels. This replay measures current
selection and ordinary fallback, not the SDK's browser capture or changing-page guards.

## Cost and tokens

These are estimates using the repository's existing USD-per-million assumptions: Luna input
$0.10, cache reads $0.01, output $0.50; Decider input $0.02. They are not verified current invoice
prices. Only usage-bearing responses can be priced. Output includes reasoning tokens reported by
the provider. Browser costs are excluded.

Amounts below are per 1,000 evaluated task trials and count only the operation under test.
Act tasks can contain multiple actions. Setup and grading model calls remain in the raw results
and have separate whole-task cost totals in the aggregate.

| Workload               | Uncached baseline / decision | Change | With reported cache reads, baseline / decision |
| ---------------------- | ---------------------------: | -----: | ---------------------------------------------: |
| Live act               |              $0.782 / $0.397 | -49.2% |                                $0.769 / $0.378 |
| Cached HTML extraction |              $1.033 / $0.371 | -64.1% |                                $0.983 / $0.364 |
| Frozen extraction      |              $2.314 / $0.851 | -63.2% |                                $1.061 / $0.427 |
| Frozen observe         |              $2.112 / $2.071 |  -1.9% |                                $0.573 / $0.820 |

Observation's reported-cache estimate increased 43.1%. Its combined input rose from 3,062,515 to
4,703,940 tokens. Decider's cheaper input was largely offset by repeated candidate classification
and large Luna fallbacks. A faster median does not imply a cheaper observer.

Provider caching was common on repeated frozen inputs. Replay scheduled Luna then Decider per task
with concurrent jobs, so shared prompt caching and provider load can affect latency. These timing
results do not establish fresh-page tail latency. The cached SDK pairs alternated their first arm
by task and round, with fresh browsers and Stagehand caching disabled.

## Live-page limitations and checks

The initial paired run completed all 77 existing bench tasks once. Act's final snapshots showed no
Vercel checkpoints. Extraction showed checkpoints in 21/25 final snapshots per arm, and observation
in 7/12. Their raw scores were 3/25 and 3/12 in each arm. These measure failed page access, not
representative extraction or observation quality. Remaining live repetitions were stopped. Four
completed second-round rows and the interruption record remain in the original directory.

For extraction, 19 existing tasks had cached SingleFile HTML. They ran through the rebuilt SDK and
extension with unchanged instructions, schemas and graders. Both arms failed `extract_single_link`
in all three rounds because the snapshot resolved `#contact` against the localhost fixture origin.
The raw 52/57 and 54/57 scores retain this environment failure. Excluding that named URL control,
baseline passed 52/54 and decisions 54/54. The two remaining baseline failures returned 16 and
18 of 24 public notices. Decisions copied the full list directly in both paired trials.

Six original extraction bench tasks lacked cached HTML and were not part of that SDK subset:
`extract_apartments`, `extract_github_stars`, `extract_nhl_stats`, `extract_repo_name`,
`extract_staff_members`, `iframe_hn`. All were attempted in the initial full live round.

Seven tasks in the wider frozen corpus lacked snapshots and were excluded before inference:
`apartments`, `promotion_dockerfile_overview`, `promotion_neon_plans`,
`promotion_public_runner_architectures`, `promotion_git_range_shorthands`,
`live_redis_general_data_types`, `live_python_combinatoric_iterators`.

The six synthetic public-SDK extraction fixtures passed 18/18 per arm over three rounds. They
check grouping, absent values, zero, nested-schema fallback and links. They are integration checks.

The standard eval initializer supplies `EVAL_SYSTEM_PROMPT`. Current decision observation declines
all nonempty custom system prompts with `custom_instructions`. A separate exact-prompt run on the
12 original observe tasks passed 9/12 in both arms, with all 16 decision-observe invocations falling
back and zero decision requests. Its final snapshots had no Vercel checkpoints. Using that harness
unchanged does not measure decision observation. The main decision comparisons omit the prompt in
both arms. No production policy or existing grader was changed to improve scores.

## Evidence and reproduction

Raw paths below are relative to `vendor-repos/system-one-corpus/runs/` and remain Git-ignored.
The committed aggregate records their absolute paths and hashes.

| Evidence                                   | Directory                                       |
| ------------------------------------------ | ----------------------------------------------- |
| Full live attempt and complete first round | `bench-comparison-2026-11-16/`, `round-0/`      |
| Cached-page SDK extraction                 | `bench-cached-extract-2026-11-16/`              |
| Frozen extraction, 492 results             | `archive/e8747738-5efe-4420-97b9-c3ea78bf63b5/` |
| Combined unchanged observation captures    | `observe/bench-combined-capture-2026-11-16/`    |
| Frozen observation, 306 results            | `observe/bench-comparison-2026-11-16/`          |
| Exact harness prompt diagnostic            | `bench-comparison-prompt-2026-11-16/`           |
| Synthetic extraction fixtures              | `bench-extract-fixtures-2026-11-16/`            |

The frozen extraction archive contains source and snapshot bundles. Live comparisons retain
runner sources, task hashes, decision sources, fixture HTML where used, final snapshots, usage and
traces. The rebuilt extension hash is
`7c953466ac859b465650a9fb3a5cd0aa39aa8c67c767dafbd2a17b40ef46987d`.

Run from the repository root with existing credentials in `.env`. Each live/replay output directory
must be new. Select `BENCH_TASKS`, `BENCH_ROUNDS`, `BENCH_CONCURRENCY` and optional
`BENCH_CACHED_HTML=1` for the SDK runner. Cached mode requires tasks with saved HTML.

```sh
pnpm --filter @browserbasehq/stagehand-extension build
BENCH_ROUNDS=3 BENCH_CONCURRENCY=3 node --env-file=.env --import tsx packages/sdk-ts/scripts/system-one/benchComparison.ts vendor-repos/system-one-corpus/runs/new-bench-comparison
```

Frozen extraction uses `REPLAY_ARMS=runtime-luna,runtime-decider`, `REPLAY_ROUNDS=3`,
`REPLAY_CONCURRENCY=4` and `REPLAY_TASKS` pinned to `extractionSelection.included` in the aggregate.
`runtime-luna` invokes the same current production extraction service with no decisions configured.

```sh
OBSERVE_ARMS=runtime,luna OBSERVE_ROUNDS=3 OBSERVE_CONCURRENCY=3 node --env-file=.env --import tsx packages/sdk-ts/scripts/system-one/observe/replay.ts vendor-repos/system-one-corpus/runs/observe/bench-combined-capture-2026-11-16 vendor-repos/system-one-corpus/runs/observe/new-bench-comparison
python3 packages/sdk-ts/scripts/system-one/benchSummarize.py <complete-run-directory>
```

The summarizer rejects incomplete runs and duplicate task/arm/round rows. SDK summaries also check
archived task hashes. Scoped TypeScript lint/format, Python lint/format and Python compilation
passed. The extension build and scored SDK runs passed execution. No production runtime, task
grader, branch history or PR changed.
