# System One experiments for observe()

Status: implemented and measured November 15–16, 2026. See [OBSERVE_RESULTS.md](./OBSERVE_RESULTS.md) for frozen replay, live SDK confirmation, rejected variants and limitations. The original plan below is retained. Observe changes remain uncommitted on top of the act/extract partial commit.

The question is whether one decision model plus ordinary LLM fallback can return useful, correct and complete observations faster than ordinary `observe()`. Start with a few live pages, freeze snapshots and labels, compare one hypothesis at a time, and execute promising observations through the public SDK.

## Evidence to carry forward

Read [EVALUATION.md](./EVALUATION.md), [ACT_RESULTS.md](./ACT_RESULTS.md), [DECISION_PRIMITIVES.md](./DECISION_PRIMITIVES.md), [ACT_DESIGN_AUDIT.md](./ACT_DESIGN_AUDIT.md), [ACT_PROVIDER_RESEARCH.md](./ACT_PROVIDER_RESEARCH.md), and [CLEANUP_RESULTS.md](./CLEANUP_RESULTS.md). The supplied [decision-model review](../../../../../vendor-repos/cursor_stagehand_decision_models_review.md) and [experiment transcript](../../../../../vendor-repos/chat-transcript.md) explain the earlier failures and corrections.

- Narrow target choices helped act, but did not prove multi-result discovery. The final action comparison was nine tasks on three domains, repeated three times. Those are not 27 independent pages.
- Candidate evidence mattered more than adding providers. Missing link destinations caused wrong Commons selections. Both models agreeing on the same representation can still miss the same answer.
- Extraction repeatedly accepted incomplete lists. A valid selector, schema, span or source ID establishes neither relevance nor completeness.
- Locate-first improved latency but accepted semantically wrong spans on fresh pages. Locate is an argument reader to investigate, not a selector or a correctness certificate.
- Replay previously omitted production URL rewriting and unfairly penalized Luna. Observe replay must reproduce production selector normalization, frame mapping and method/argument handling.
- Confidence and question packing differ by provider. Clef fields jointly attend; Jev/Decider isolation is not a universal assumption. Keep provider comparisons separate from policy comparisons.

Keep all old Markdown and raw runs, including failed confirmations. These sources inform hypotheses; none establishes observe superiority.

## Establish the contract first

Observation selects elements and describes possible actions without performing them. Split the work into candidate discovery, relevance selection, action construction and selector resolution. Reuse act's contextual evidence where useful, without inheriting its click/fill-only coverage or top-30 shortlist as the definition of observation.

Freeze these workload classes separately:

| Workload                             | Correctness requirement                                                                                                |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| One specific element                 | One acceptable DOM identity, with the requested method/arguments where supplied                                        |
| Several or all matching elements     | Exact expected set, no irrelevant additions, no silent truncation                                                      |
| Absent target                        | No fabricated match; distinguish a correct empty result from abstention/fallback                                       |
| Ambiguous instruction                | Frozen acceptable alternatives or explicit escalation, never a posthoc grader change                                   |
| No instruction                       | Match the existing comprehensive future-actions contract; evaluate required, allowed and forbidden controls separately |
| Locate-only text, heading or section | Correct locator and compatible observation output; do not equate locating text with authorizing a click                |
| Action with arguments                | Correct target, method and grounded arguments; unspecified fill values may legitimately remain empty                   |
| Scoped, ignored or framed content    | Respect locator scope and exclusions, preserve frame identity and public selector semantics                            |

Inspect the ordinary prompt, `Action` schema and existing observe tests before defining acceptable methods. `fill` versus `type` equivalence must be decided before inference. Do not invent a fill value just to make an observation executable. File upload, select, hover, press, scroll and drag requests must either meet that contract or use the ordinary fallback.

The old observer is a baseline, not a specification. It uses an overlapping intent/cardinality request, old best/strict selection for one result, per-candidate predicates for several results, and deterministic interactive enumeration without an instruction. It falls back past 400 no-instruction elements or 600 relevance candidates, batches relevance at 60, and uses thresholds 0.7/0.6. Empty relevant sets fall back. Preserve those settings in the historical control; do not quietly improve it during the comparison.

## First capture batch

Prepare roughly 16 instructions across four live pages. These are proposed development targets, not verified captures or held-outs. Several domains were already used for act/extract.

| Proposed page                                                                | Tasks to write before capture                                                               | Question it tests                                 |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| <https://books.toscrape.com/>                                                | One named product action, all visible product actions, absent product, no instruction       | Repeated labels and record context                |
| <https://httpbin.org/forms/post>                                             | One named field, all fields in a named group, literal fill, locator scope                   | Field groups, method/argument correctness         |
| <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input> | One heading, all links in a named section, absent section, ignored navigation               | Readable targets, boundaries and dense navigation |
| <https://demo.playwright.dev/todomvc/>                                       | All item controls after deterministic setup, one item, completed-only scope, no instruction | Stateful lists and repeated controls              |

Record inaccessible pages, bot walls and absent proposed controls before inference. Replace a failed capture with a logged reason, or freeze it as a negative where appropriate. Never pick replacement tasks based on model scores. Freeze reset steps and task wording before the first call.

Add controlled HTML cases for iframe/shadow boundaries, nested clickable text, native select versus ARIA combobox, disabled/readonly/hidden controls, editable regions, file inputs, keyboard actions and same-XPath replacement. Include a set exceeding each old cap, a matching item beyond position 30, and an empty scoped region. These diagnose mechanisms; report them separately from live public pages.

Freeze each case with:

- URL, time, viewport, browser/extension versions, revision and setup/reset procedure.
- Full AX tree, XPath/URL maps, editable IDs, frame information, screenshot and relevant DOM facts. Store unavailable facts explicitly.
- Instruction, workload, gold DOM identities or acceptable equivalence groups, required/allowed/forbidden matches, permitted methods/arguments and expected fallback/empty behavior.
- Selector-to-element identity checks. Matching input `innerText` is insufficient because different inputs can all return an empty string.
- For actionable cases, resettable observe-then-act postconditions and forbidden effects. Use harmless test environments for execution.

Labels come from captured DOM evidence before inference, never another model's output. Keep labels and grader selectors out of model requests. Hash inputs, labels, source versions and exact provider requests in the manifest.

## Baselines and diagnostic comparisons

Run three end-to-end baselines on identical frozen inputs:

1. Ordinary `stagehand.observe()` with pinned Luna, full ordinary prompt and production normalization.
2. The retained Miguel observer at `9080038614bcaf5ee32afad44970f282ad0c73bd`, explicit provider/model, original settings and Luna fallback.
3. A deterministic exact-name/role resolver or interactive enumerator, restricted to cases where its contract applies; otherwise abstain.

Use `prepareBaseline.ts` and archived source manifests for historical reproducibility. Record both historical source revision and any harness adaptation. Do not change historical prompts to make them fit the new candidates.

Separately compare selection policies on the same fixed candidate set and evidence. This isolates a model-policy effect; it is not an end-to-end product score. An oracle candidate set diagnoses retrieval failures only. Count a gold element missing from the real candidate set as a discovery failure even if the model confidently selects something else.

## Ordered hypotheses

| Experiment                     | Change one thing                                                                                           | Evidence against the hypothesis                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| H1: one-result selection       | Old best/strict versus one choice with explicit no-match, same candidates, fixed action construction       | More wrong accepts, lower useful coverage, or no completed-call latency improvement |
| H2: contextual evidence        | Compact role/name versus added section/form/row, destination and state facts, selection policy fixed       | Candidate misses, wrong scope or no gain after evidence-building cost               |
| H3: complete-set selection     | Per-element predicates versus group selection followed by per-element predicates, evidence and model fixed | Any silent omission, extra match or wrong-group acceptance                          |
| H4: negative and empty results | Explicit empty/ambiguous answers with complete candidate accounting versus old empty-to-fallback policy    | A false empty on a positive task, or false positive on an absent request            |
| H5: no-instruction discovery   | Deterministic enumeration versus model-filtered enumeration and ordinary observation                       | Missing required future actions or adding unusable/duplicate controls               |
| H6: action construction        | Code-built grounded method/arguments versus instruction-only intent inference, selected targets fixed      | Correct target but wrong operation, invented arguments or extra fallback/latency    |
| H7: packing and providers      | Winning policy on pinned Flash/Jev/Clef; then a separate packed-versus-isolated comparison                 | Wrong accepts or completeness losses hidden by average accuracy                     |
| H8: live stability and cache   | Identity recheck and standard cache behavior versus unchanged live controls                                | Stale result, different-node resolution, dropped frame/scope or wrong first effect  |

Start with H1 on Decider v1.3. Do not bundle representation, threshold, batching and provider changes into that result. For H3, every eligible candidate must be accounted for. Group routing that discards a matching group is a recall failure. Under budget limits, escalate rather than returning the first N matches as "all". Selection and output order must remain deterministic after concurrent batches.

Test reorder sensitivity and batch-boundary effects independently. Calibrate thresholds only on development data, show risk against direct coverage, then freeze the setting. Do not transfer old Jev thresholds to another provider by assumption. Use one System One model with one System Two fallback as the product candidate. Multiple-model agreement stays research-only.

Locate/Clairic may later read literal arguments from a bounded instruction or evidence sheet. Exact offsets and schema checks do not establish that the argument answers the request. Keep generated or ambiguous arguments on the ordinary fallback until separately supported. OpenAI remains a researched provider, not an implemented/benchmarked arm.

## Metrics and run protocol

Run three interleaved rounds, rotating arm order and using identical deadlines/concurrency. Repeats measure consistency, not additional independent pages. Disable caches for primary policy comparisons; measure warm-cache behavior separately.

Report per workload and overall:

- Candidate recall before model selection; element precision/recall and exact-set accuracy. Show omissions, additions and duplicates separately.
- Correct direct accepts, wrong direct accepts, false empties, abstentions, fallbacks and final correctness after fallback. A direct set with even one missing required element is a wrong direct accept.
- Method/argument accuracy separately from selector identity and set selection. Grade unspecified arguments according to the frozen contract.
- Selection-only, SDK observe and complete observe-then-act latency, p50/p95 including failures/fallback, with timeout/drift counts. With fewer than 20 samples, nearest-rank p95 is the maximum.
- Snapshot, candidate building, decision, normalization/identity and fallback times; request count, provider/model usage and reported cache reads. Cost is secondary to architecture/correctness, but include all failed and fallback work when reported.
- No-instruction required-set recall and allowed-set precision, separate from exact-set workloads. Do not force a subjective relevance list into a false exact oracle.

Run live contenders from independently reset states. Capture before observation, resolve every returned selector against intended DOM identities, and execute only the frozen actionable subset. Record wrong first effects even if a later fallback recovers. A valid heading locator need not be clicked to prove its correctness.

Inject replacement and relabeling while inference is pending and between observe and act. Observation cannot guarantee a future node remains valid. Revalidate through the normal action executor; check both fresh and cached observations. Preserve timeout, cancellation, variables, scope and frame behavior. Do not add another public policy flag.

Existing evals are regression inputs, not sufficient graders. `observe_taxes` checks a count and one text match, which can pass an incomplete/wrong set. `observe_file_uploads` and iframe tests compare element identity, a useful pattern. Cover all 12 tasks under `packages/evals/tasks/bench/observe/`, while retaining stricter frozen completeness and argument checks in the new harness.

## Iteration and promotion gates

After every run, record hypothesis, frozen hashes, baseline revision, changed variable, counterexamples and keep/revise/drop decision. Fix a general failure, rerun the regression set, then reserve new pages for confirmation. Never change a frozen grader after observing model answers; corrections require a new version and transparent rescoring of every arm.

Advance a candidate only when it introduces no wrong direct results or false empties in the scored batch, preserves paired baseline successes and completeness, has useful direct positive coverage, and improves full SDK median without a worse measured tail. If it only saves cost, report the latency tradeoff. Mixed results keep the baseline in place.

Before SDK promotion, capture a confirmation set on at least three domains unused in observe development, checking overlap with all act/extract corpora. Freeze before inference and rerun in a separate provider session. Retire any confirmation set used to fix code into regression. Zero observed errors on a small batch supports the next experiment; it does not establish 100% parity or release readiness.

## Implementation sequence and artifacts

1. Add `system-one/observe/{tasks,capture,replay,live}.ts` and an observe-specific frozen label schema. Reuse transport, outline and candidate evidence helpers; keep gold labels outside requests.
2. Capture the four-page development set and controlled cases. Publish a capture inventory and frozen grader hashes before model runs.
3. Run ordinary Luna and historical observer controls, then H1. Follow with representation and set-selection experiments individually. Save failures before editing code.
4. Run winning candidates through public SDK observation, selector identity checks and resettable observe-then-act tasks. Confirm live latency and scope/frame/argument compatibility.
5. Run untouched site-disjoint confirmation. Only then replace the observer, remove its legacy dependency chain and update public documentation.

Store new runs under `vendor-repos/system-one-corpus/runs/observe/<run-id>/`: manifest, source hashes or source archive, snapshots/maps/screenshots, separate labels/graders, exact requests/responses, results JSONL, usage/timing and findings. Add an `OBSERVE_RESULTS.md` with explicit replay/live/controlled labels after the first scored run. Never overwrite old raw evidence. Keep the research index updated as experiments move from proposed to measured.
