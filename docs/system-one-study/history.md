# System One historical audit

Council base: `93b9d913281cd361a296f3126712827700215b53` on `decisions-beta`. The strongest prior signal is lower extraction median latency on the measured regression sets. Observe headroom depends on candidate coverage and fallback cost. Act has promising bounded-policy results and weaker evidence on the broader suite. All three need a same-build Luna control for the council comparison.

Paths beginning with `vendor-repos/` resolve under `/Users/vishal/Developer/personal/forks/stagehand`. The parent checkout ignores that directory. Git refs below identify source trees. Archived manifests, patches and build hashes identify measured variants, including pre-commit changes.

## Source lineage and drift

| Source | What it establishes |
| --- | --- |
| Miguel's original stack, #2951–#2955, #2988 and #2993 | Editable snapshot IDs, Jev and candidate picking, the act tree, observe/cache checks, extraction pick-and-copy, WebMCP routing and intent overlap. The seven-PR tip was `be81ca18be`. The later integrated control at `66fba4546` includes readiness, provider adapters and the SDK namespace. |
| Detached `stagehand-decisions` checkout at `5601371a0` | Early `decision-benchmark.ts` and `report-decisions.mjs` entry points from `9f459a236`, with focused reruns added. The nested System One experiments developed later on the other branch. |
| `908003861`, `7bd1902c2`, `7dc4e311a`, `03a451b3d` | Guarded action plans, act/extract cleanup, observe cleanup, and the precision/observe/benchmark fixes, respectively. Several measured runs preceded their commits. The two frozen extraction campaigns both declare `7dc4e311a` in their manifests and have different source hashes. |
| PR #3467 benchmark pin `82d0ee167` and archive removal `e17c74aff` | Identical complete trees, `861ef7dbd89917127f20092b861c12452f2f48af`. The four-arm PR report measures this beta, before the subsequent observe changes. |
| Observe follow-up, `a0761e1ed`, and beta squash `4d7160747` | These two commits share full tree `be24cc806afc0beaa065d8445da84cf76db8d93f`. The follow-up's measured `e17c74aff+uncommitted` archive predates the final implementation. Its `actionFacts.ts`, `observe.ts` and `observeSelection.ts` differ byte-for-byte from the council base. |
| `8f655fab4` and council base `93b9d9132` | Two upstream merges after the squash. The tracked decision services match `4d7160747`. The TypeScript namespace imports browser API code from the shared package. Extension packaging, existing-document script injection and network-idle handling changed upstream, so live latency and behavior need a new run even with byte-identical decision services. |

The current product contract lives in [experimental-decisions.mdx](../../packages/docs/v4/reference/experimental-decisions.mdx) and [.changeset/experimental-decisions.md](../../.changeset/experimental-decisions.md). The namespace accepts a provider, credentials and one model for all three operations. Perplexity defaults to pinned Decider v1.3. TypeSafe and Cloudflare adapters remain. Click and literal-fill plans, observe selection and record extraction fall back to the configured LLM when the policy declines. Ordinary methods use the regular LLM path, including single-call ordinary extraction. Public prototype flags such as `act: "plans"`, `extract: "map"` and `llmFallback` belong to archival revisions. The old picker, intent tree, completion judge, decision cache checks, readiness loop and WebMCP decision routing were retired. Current smoke, configuration and behavior tests are under `packages/sdk-ts/tests/browser-runtime/`, `packages/protocol/tests/protocol/` and `packages/extension/tests/`. The release review records historical build, workspace, Python and provider conformance results. [Cleanup results][cleanup] · [Release review][release]

## What the comparisons measured

### Four-arm PR regression

The November 16 PR comparison used 71 existing tasks, three rounds and four arms. I counted 852 unique operation/task/round/arm rows in the archived JSONL and reproduced the pass counts below. Its raw SHA-256 matches the report. The same-revision Luna control used single-call extraction. The older Luna control at Miguel's revision used a completion round trip and is useful for history.

| Workload | Ordinary Luna on PR | Miguel + Decider | Old beta + Decider | SDK call p50, same order |
| --- | ---: | ---: | ---: | --- |
| Act | 116/120 | 102/120 | 108/120 | 2.60 / 1.47 / 2.64 s |
| Extract | 57/57 | 51/57 | 56/57 | 2.67 / 3.71 / 1.48 s |
| Observe | 30/36 | 30/36 | 28/36 | 2.03 / 1.22 / 2.77 s |

The runner interleaves four arms with rotated order, fresh browser sessions and shared graders. Both decision stacks request `pplx-decider-v1.3`. All LLM arms use `openai/gpt-6-luna` via the same gateway callback. Act and observe use live navigation, with a shared public fixture mirror after checkpoint failures. Extract uses 19 saved HTML tasks in a browser, with restored origins. Six original extraction tasks lacked saved HTML and were excluded before scoring. Miguel's older RPC timeout, the common installed dependencies, revised fixture URLs and shared grader compatibility patch make this a comparison of whole stacks in that environment. The 71 task count matters for uncertainty. Three rounds measure repeatability. Task passes and SDK call percentiles use different denominators, and extraction's beta p95 was 16.47 s against ordinary Luna's 15.53 s. [PR benchmark report][pr-report] · [Manifest and exact runner][pr-run]

### Cleanup and fixes

I checked the preserved result rows for the initial and final extraction replays, the corrected action suite, cached extraction and both final observe workloads.

| Workload | Ordinary Luna | Fixed decisions | Interpretation |
| --- | ---: | ---: | --- |
| Corrected live act, 40 tasks once | 38/40 | 39/40 | SDK p50 tied at 2.75 s. The grader waits for the same navigation outcome. Keep the earlier original-grader run, 113/120 vs 112/120, as a separate series. |
| Cached-page SDK extraction, 19 tasks × 3 | 54/57 | 57/57 | 2.62 vs 1.51 s p50. Corrected fixture origins account for three recovered decision trials. |
| Frozen extraction, 82 tasks × 3 | 231/246 | 240/246 | 2.73 vs 1.38 s p50. The preserved decision arm in the same run scored 237/246. |
| Public SDK observe, 11 tasks × 2 | 22/22 | 22/22 | 1.45 vs 0.65 s p50. Two decision fallbacks on this set. |
| Frozen observe, 51 tasks × 3 | 152/153 | 153/153 | 1.73 vs 0.73 s p50. Estimated cached cost rose from $0.347 to $0.429 per 1,000 trials. |

The 738-row frozen extraction run interleaves all three arms on identical evidence. Enlarging bounded paragraph previews exposed a precise scalar that the original picker and second reader had missed. Wrong direct returns dropped from three to zero on those snapshots. Fallbacks went from 51 to 57. Two other changed outcomes remain subject to model variation. The initial two-arm extraction replay has 492 rows and different source hashes. Use the final run's paired controls.

The original fresh live attempt hit checkpoints in 21/25 extraction and 7/12 observe final snapshots per arm. Its low scores diagnose page access. The exact-harness-prompt observe control passed 9/12 each with all 16 experimental calls routed to Luna. The council base still passes `EVAL_SYSTEM_PROMPT` through [the eval initializer](../../packages/evals/initStagehand.ts#L140), and [the decision observer](../../packages/extension/services/decisions/observe.ts#L79) declines custom instructions. A comparison meant to exercise decisions needs prompt parity and a routing check. Keep real custom instructions as a separate fallback control. [Initial comparison][comparison] · [Fixes and remeasurement][fixes]

### Later observe iteration

The 144-row follow-up compared four arms across the same 12 eval tasks in a separate session. I verified new/old/Miguel/current-Luna scores of 30/36, 28/36, 29/36 and 28/36. New vs old beta SDK p50 was 2.18 vs 3.20 s and p95 was 4.21 vs 15.26 s. Median paired summed observe speed on jointly passed tasks was 0.99×. Decision input fell 84.8% despite more decision requests. The narrower DOM fact collection, frame-aware evidence, intent routing, role views and batched membership enabled the new path. The separate evidence snapshot before each SDK timer and the source drift above preclude pooling with the PR report or labeling it a run of `93b9d9132`.

The added independent labels are stronger evidence of exact target identity and complete sets on their captured inputs. Preserve the original and corrected labels when rescoring. A fresh two-page set still lost one ordinal case's direct coverage and ran slower at the median. Earlier small live confirmations and explicit Flash follow-ups reuse captured task definitions and have separate paired Luna controls. [Observe follow-up][observe-report] · [Observe experiment results][observe-results]

## Findings to carry into the council benchmark

- **Extract.** Measure evidence generation and ranking before tuning providers. A model cannot select omitted prose, a missing row or a dropped heading. Use an oracle group and an automatic group on the same snapshots, then score exact copied spans, optional/nullable absence, explicit zeros, inverse units and complete lists. The heldout-4 22/22 regression and 70/70 list replay followed tuning. Fresh tests exposed incomplete lists, inverse columns, precision conflicts and whitespace in captured evidence. Exact source occurrence and schema validity carry weaker guarantees than semantic correctness or completeness. Locate-primary and fresh retry/coverage trials lost on some live SDK sets despite favorable targeted replays. Keep ordinary single-call Luna, and measure compaction or fallback prompt changes as their own arms. [Decision primitives][primitives] · [Extraction provider research][providers]
- **Act.** Keep known-operation target resolution distinct from free-form actions. The older compact prompt-locator comparison changed both representation and supplied intent. The first live complete-action confirmation exposed disabled controls in the Luna handoff. After guarding execution, nine fresh tasks × three rounds passed 27/27 for the new complete-action policy and Luna, versus 24/27 for the old tree. The paired Flash rerun on those same tasks cut SDK median from 2.31 to 1.01 s. Validate element identity, destination and input effects, including fallback and mutations. Two short workflow smokes and the injected same-XPath replacement controls establish narrower behavior. [Action results][act-results] · [Action design audit][act-audit]
- **Observe.** Grade single targets, exact sets, absence and no-instruction discovery separately. Score identities, duplicates, method/arguments and false empty returns. Revalidate the candidate universe for set/empty results. Candidate-local context and shared instruction text reduced duplicated input. Grouping and serial routing were slower in some comparisons. A corrected native-field label exposed a counting error in the grader, while the live suite lacks independent labels for every direct result. Preserve both label versions and record wrong-direct counts only where the labels support them. [Observe results][observe-results] · [Observe experiment protocol][observe-experiments]
- **Comparability.** Keep per-call SDK, task completion, frozen replay and actual end-effect clocks separate. Freeze prompts, model IDs, task definitions, grader revisions and build hashes. Split by site before inference, with accessed or iterated sets marked as regressions. Keep failures, blocked-page counts and missing-snapshot exclusions. Report direct correct, wrong direct, fallback and final pass on the same paired inputs. Estimate token costs with observed and repriced cache reads, provider-level usage, deadlines and unpriced responses. Cache repricing answers a cost question. A cold-latency claim requires a separate measurement. [Evaluation protocol][evaluation] · [PR benchmark method][pr-report]

## Reusable evidence and document map

All 120 relocation entries exist under `vendor-repos/experimental-decisions/`. I verified their listed SHA-256 values, using the post-relocation value when present. The manifest points to `03a451b3d`. Relocated scripts and captured private inputs should stay local. Reuse task definitions, safe fixtures and metadata after checking provenance and import paths.

| Local path | Reuse |
| --- | --- |
| `vendor-repos/chat-transcript.md` and `vendor-repos/cursor_stagehand_decision_models_review.md` | Design chronology and rejected approaches. The transcript's early sections cover native readers and evidence failures, lines 2850–3200 cover the early benchmark, and lines 14650–15246 cover single-call extraction. Cursor's review traces the move toward map-and-copy and narrow target selection. Treat conversational score claims as leads for the underlying run. |
| `vendor-repos/experimental-decisions/packages/sdk-ts/scripts/system-one/` | `benchComparison.ts` and `benchSummarize.py` for SDK pairs and completeness checks. `capture.ts`, `replay.ts`, `corpus.ts`, `heldout*.ts`, `groupLabels.ts` and `groupAudit.ts` for evidence and graders. `act/` and `observe/` preserve task definitions, outcome and mutation checks, versioned labels, and replay/live entry points. Use the archive beside the historical runtime or port harness code explicitly to the council base. |
| `vendor-repos/system-one-corpus/runs/pr3467-2026-11-16/` | Exact runner, task and fixture hashes, worker builds, source archives, three compatibility/instrumentation patches, cost inputs and independent audit. `full/results.jsonl` contains all four arms, including the historical Luna control. |
| `vendor-repos/system-one-corpus/runs/` | `archive/e8747738-5efe-4420-97b9-c3ea78bf63b5/` and `archive/f178992a-ee7f-4a18-95f6-59d331864155/` contain initial and final frozen extraction runs, archived sources and snapshots. `fixes-2026-11-16/` contains source/build manifests and corrected SDK comparisons. `cleanup/2026-11-15/`, `act/` and `observe/` retain the earlier sources, probes, controls and confirmation runs. |
| `vendor-repos/observe-improvement/` | `live-final-labels/` contains final sourced results, manifest, worker, pre-commit patch and audited summary. The sibling capture/replay paths have original and corrected labels, post-change reserved inputs and the cross-origin SDK control. |

Under the archived `system-one/` directory, `README.md` and `docs/INDEX.md` lead to the study. `ARCHITECTURE.md`, `REVIEW.md`, `DIRECTIONS.md`, `ROADMAP.md` and `NEXT_STEPS.md` describe the extraction prototype and promotion criteria. Use `CLEANUP_RESULTS.md` to resolve superseded config examples. `ACT_EXPERIMENTS.md`, `ACT_PROVIDER_RESEARCH.md` and `act/README.md` specify the act arms and timing. `OBSERVE_TYPESAFE_CLOUDFLARE_RESEARCH.md` and `OBSERVE_OPENAI_PERPLEXITY_RESEARCH.md` cover vendor contracts, packing, confidence and exact-set implications. They describe capabilities as of their research date. The act and observe results do not benchmark OpenAI Decisions. An extraction group probe used Luna Decisions via AI Gateway, a separate arm from Luna Responses. `results/` contains the comparison aggregates, and `cleanup_branch.md` at the archive root records the removal criteria. [Research index][index] · [Relocation manifest][relocation]

The strongest vendor analogues are `vendor-repos/JevRouter/docs/jev-primitives.md` and `docs/cookbook/07-policy-and-confirmation.md`, which preserve provider probabilities separately from execution policy, and `vendor-repos/semantic-router/bench/router_flow/SIGNAL_DECISION_EVAL_PLAN.md` and `tools/agent/docs/plans/pl-0044-sr-bench-1.0.md`, which pin recipes and scorers, account for every child request and separate repricing from latency. Semantic Router's `website/docs/proposals/system-one-api-schemas.md` and compatibility matrix are useful for adapter contract tests. `vendor-repos/model-router/README.md` supplies an operational analogue for bounded escalation and separate queue/deadline metrics. Cookbook examples can supply task ideas after a site-overlap check. Geld, the WebMCP inspector and the WebMCP tools collection concern browser workflows or retired tool routing and contribute no comparable Stagehand decision scores.

Audit scope was local history, reports, source comparisons, manifests and scored records. The audit checked archive integrity and recomputed selected denominators and pass counts. It places no new SDK or provider calls and includes aggregate evidence only.

[pr-report]: /Users/vishal/Developer/personal/forks/stagehand/vendor-repos/DECISIONS_BETA_BENCHMARK_REPORT.md
[pr-run]: /Users/vishal/Developer/personal/forks/stagehand/vendor-repos/system-one-corpus/runs/pr3467-2026-11-16/full/manifest.json
[observe-report]: /Users/vishal/Developer/personal/forks/stagehand/vendor-repos/EXPERIMENTAL_DECISIONS_OBSERVE_REPORT.md
[release]: /Users/vishal/Developer/personal/forks/stagehand/vendor-repos/experimental-decisions/verification/production-readiness.md
[relocation]: /Users/vishal/Developer/personal/forks/stagehand/vendor-repos/experimental-decisions/relocation-manifest.json
[index]: /Users/vishal/Developer/personal/forks/stagehand/vendor-repos/experimental-decisions/packages/sdk-ts/scripts/system-one/docs/INDEX.md
[cleanup]: /Users/vishal/Developer/personal/forks/stagehand/vendor-repos/experimental-decisions/packages/sdk-ts/scripts/system-one/docs/CLEANUP_RESULTS.md
[comparison]: /Users/vishal/Developer/personal/forks/stagehand/vendor-repos/experimental-decisions/packages/sdk-ts/scripts/system-one/docs/BENCH_COMPARISON_2026-11-16.md
[fixes]: /Users/vishal/Developer/personal/forks/stagehand/vendor-repos/experimental-decisions/packages/sdk-ts/scripts/system-one/docs/FIXES_RESULTS_2026-11-16.md
[evaluation]: /Users/vishal/Developer/personal/forks/stagehand/vendor-repos/experimental-decisions/packages/sdk-ts/scripts/system-one/docs/EVALUATION.md
[primitives]: /Users/vishal/Developer/personal/forks/stagehand/vendor-repos/experimental-decisions/packages/sdk-ts/scripts/system-one/docs/DECISION_PRIMITIVES.md
[providers]: /Users/vishal/Developer/personal/forks/stagehand/vendor-repos/experimental-decisions/packages/sdk-ts/scripts/system-one/docs/PROVIDER_RESEARCH.md
[act-results]: /Users/vishal/Developer/personal/forks/stagehand/vendor-repos/experimental-decisions/packages/sdk-ts/scripts/system-one/docs/ACT_RESULTS.md
[act-audit]: /Users/vishal/Developer/personal/forks/stagehand/vendor-repos/experimental-decisions/packages/sdk-ts/scripts/system-one/docs/ACT_DESIGN_AUDIT.md
[observe-results]: /Users/vishal/Developer/personal/forks/stagehand/vendor-repos/experimental-decisions/packages/sdk-ts/scripts/system-one/docs/OBSERVE_RESULTS.md
[observe-experiments]: /Users/vishal/Developer/personal/forks/stagehand/vendor-repos/experimental-decisions/packages/sdk-ts/scripts/system-one/docs/OBSERVE_EXPERIMENTS.md
