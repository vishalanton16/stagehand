# System One experiments for act()

Current cleanup status: see [CLEANUP_RESULTS.md](./CLEANUP_RESULTS.md). Prototype flags and source paths below describe the measured pre-cleanup implementations unless stated otherwise. Historical results and caveats are preserved.

Status: the initial research, frozen replay, live comparisons, mutation checks and two workflows are complete. See [ACT_RESULTS.md](./ACT_RESULTS.md) for outcomes and limitations. Research added a complete-action choice experiment beyond the original target-only plan below. The protocol remains the reference for further batches.

The question is whether a decision model can resolve browser actions with fewer tokens or less latency than Luna, without accepting more wrong actions. Start with a few live pages, freeze their snapshots, test one hypothesis, execute promising variants live, and repeat. Keep extraction's [fresh comparison](./NEXT_STEPS.md#current-experiment-order) as an independent task.

## What we already know

The supplied `vendor-repos/chat-transcript.md` records a target-selection comparison on 14 controlled HTML fixtures. Compact, ranked candidates with a single choice and an explicit no-match option accepted zero wrong selections on the reserved fixtures, versus six for the original picker. Joint operation and target inference missed six valid actions. These are development results, not evidence of reliability on unfamiliar live pages.

The earlier prompt-locator comparison supplied the operation in advance and used a different page representation. Its timing cannot isolate the benefit of fewer requests. The adapted Apple workflow also inserted a direct store navigation and failed the final extraction in both arms. It does not establish end-to-end action gains.

The supplied `vendor-repos/cursor_stagehand_decision_models_review.md` recommends narrow decisions over evidence that Stagehand can inspect. Extraction's later results add an important limit: valid output, model agreement, and source provenance can all accompany the wrong answer. For actions, an existing selector and a successful click can likewise target the wrong control.

## Two separate workloads

1. **Known operation.** The caller supplies click, fill, or select plus its literal argument. The model resolves the target. This is the smart-selector experiment. Compare policies given the same operation and arguments.
2. **Free-form act().** The caller supplies only an instruction. The policy must determine the operation, target, arguments, and any next step. Compare against ordinary `stagehand.act()` and the existing experimental pipeline. Charge intent and argument inference to this workload.

Use existing action execution and provider adapters. Keep candidates in the benchmark until the experiment passes a fresh live check. A known-operation win does not establish a free-form `act()` win.

## First live-page batch

Prepare roughly 12 action tasks across these five pages. These are proposed capture targets, not verified tasks or a held-out set. Some domains already appeared in extraction experiments.

| Page                                                                | Candidate task after capture                                | Failure to examine                                         |
| ------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| <https://en.wikipedia.org/wiki/Main_Page>                           | Fill search, open a uniquely specified navigation link      | Search overlays, unrelated links with similar names        |
| <https://docs.python.org/3/>                                        | Fill documentation search, open a section link              | Repeated navigation labels and section context             |
| <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference> | Open a reference link or a navigation disclosure            | Dense candidates, parent versus child targets              |
| <https://huggingface.co/models>                                     | Choose a visible task filter and inspect the selected state | Dynamic results, repeated labels, stale nodes              |
| <https://demo.playwright.dev/todomvc/>                              | Add a temporary item, toggle it, filter completed items     | Literal arguments, checked state, multi-step state changes |

Write the intended instructions before capture. If a proposed control is absent, record that fact before any model run. Mark the task unavailable or freeze an explicit negative task. Record blocked pages and replacements. Do not quietly replace pages after seeing scores.

Include at least four negative tasks with absent, disabled, or genuinely ambiguous targets. Label the expected behavior as `no_match`, `ambiguous`, `unavailable`, or `already_satisfied`. An already satisfied task may be a valid no-op; a missing target is not a successful action. Use deterministic DOM inspection to label the cases, never a competing model's answer.

## Capture and freeze

For each initial state and each state reached in a short workflow, save:

- URL, capture time, viewport, browser and extension versions, repository revision, and setup/reset steps.
- The full AX tree, XPath and URL maps, editable IDs, frame information, and a screenshot.
- DOM facts keyed to snapshot IDs: enabled, visible, editable and checked/selected state; accessible name and role; heading, row, form, or dialog context; and enough identity information to detect replacement before execution. Record unavailable facts explicitly.
- Instruction and workload type, supplied operation/arguments where applicable, acceptable target IDs, expected abstention or no-op, forbidden targets, and a deterministic postcondition.

Freeze graders after inspecting the snapshot and DOM, before any model inference. The model must never receive gold labels, expected URLs, grader selectors, or target IDs as hints. Keep model inputs separate from labels. Hash both files in the run manifest.

Store under `vendor-repos/system-one-corpus/runs/act/<run-id>/` using `manifest.json`, frozen snapshots and labels, `results.jsonl`, provider usage, before/after captures, and a short findings file. Record exact request inputs and the returned model/version, not just a moving alias. Retain failed runs and archive before drawing conclusions.

## Hypothesis 1: one target question is enough

First hold the operation, arguments, candidate builder, eligibility facts, and candidate order fixed. Start with Decider through the existing adapter. Compare:

| Arm                     | Decision policy                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------- |
| Existing picker control | Current `pickCandidate()` best/strict questions on the same candidates                  |
| Single choice           | One target choice with an explicit no-match option on those same candidates             |
| Luna resolver           | One structured target-selection response over those same candidates and known operation |
| Deterministic resolver  | Unique exact role/name match only; otherwise abstain                                    |

Use the current acceptance threshold as the initial control. Any calibration uses development pages only and is frozen before confirmation. Do not transfer a confidence threshold between providers without measurement.

Run three interleaved rounds per task, rotating arm order. Reverse candidate order as a separate sensitivity check. Report candidate recall before model accuracy, correct direct accepts, wrong accepts, abstentions, requests, tokens, and selection latency. Retain negative tasks in every arm.

Then change representation alone: full candidate descriptions versus compact role/name plus heading, row/form context and relevant state. Measure pruning separately from compaction. Audit correct-target recall against the full eligible set. If pruning removes the answer, classify a retrieval failure even if the model picks a plausible substitute.

An oracle candidate set can diagnose a retrieval failure, but is diagnostic only. Do not count it as product performance. Test the winning policy on Flash, Jev, and Clef only after this comparison explains which policy and representation helped. Reuse the same frozen tasks; record missing credentials or unsupported capabilities instead of silently dropping providers.

## Hypothesis 2: the gain survives execution

Frozen replay measures target resolution. It cannot validate browser effects or stale-target behavior.

Execute the leading resolver and its controls from independently reset page states. Give every arm the same reset procedure, viewport, deadlines, and postcondition timeout. Capture each starting state. If live content has changed enough to invalidate the frozen task, mark drift and capture a new version before continuing paired comparisons.

Before input, confirm the selected target still represents the same element and retains the operation's required state. XPath resolution alone does not prove identity. A failed check must abstain or recapture within a fixed retry budget, then use the normal LLM fallback. Never reinterpret a stale ID against a new map.

Record the actual element receiving input and check an independent postcondition: exact input value, intended destination and page content, selected option, checkbox state, or visible filtered result. Count a wrong first action even if fallback later repairs the task. Preserve prior actions during handoff; fallback must not repeat a side effect already performed.

Natural live rerenders may be rare. Add a separate controlled-mutation regression track for removed targets, replacement at the same XPath, disabled controls, overlays, and reordered rows. Label these mutations explicitly; they are not untouched live-page results. Compare behavior with and without identity rechecks before testing early target readiness.

## Hypothesis 3: free-form act() benefits too

Use the same starting states and user instructions. The ordinary Luna control receives the instruction and full snapshot, with no supplied operation. Compare:

- Ordinary `stagehand.act()` with Luna and cache disabled.
- Current `stagehand.experimentalDecisions.act()` with Decider and the same Luna fallback.
- A benchmark candidate that resolves intent/arguments first, then uses the winning target resolver. Include every intent, argument, retry, and fallback call.

The existing pipeline already overlaps some intent work with settling. Measure before removing or adding stages. Keep tool routing, cache checks, focused fallback, target readiness, and no-effect retries at fixed settings. Test each independently later. Joint intent/target selection remains an ablation, since the earlier fixture result lost coverage.

Also measure `observe()` followed by `act(Action)` for workflows where reuse is possible. Include the initial observation and any self-heal in workflow cost. Report the number of reuses separately; deterministic replay alone is not the complete inference baseline. Current guidance: [observed actions](https://github.com/browserbase/stagehand/blob/main/packages/docs/v4/basics/act.mdx).

End with two or three short live workflows, such as search then open a result, choose a filter then open a matching entry, or add then complete a temporary todo. Grade each step and the final state. No direct navigation or hardcoded selector may replace a failed model step in a scored workflow. Explicit setup belongs outside the task and must be identical across arms.

## Evidence and iteration rules

- Headline metrics are wrong accepted actions, final task success, and useful direct coverage. Report all numerators and denominators, including eligible positive tasks, negatives, unavailable captures, timeouts, and drift.
- Separate snapshot capture, candidate building, decision, identity check, execution, postcondition wait, and fallback timing. Report selection-only and full-action p50/p95, plus workflow time. Include failed attempts and timeout counts so fast failures cannot look like a speed win. With small samples, state when p95 is the maximum.
- Report decision and LLM usage separately, reported cache reads, uncached estimates and observed cost, with dated rate sources. Compare total cost per successful task including failed attempts. Do not inherit assumed rates from old scripts without checking them.
- Report wrong-accept risk against direct coverage over development thresholds. Freeze the chosen policy before confirmation. Repeated rounds measure consistency; they do not increase the number of independent pages.
- After each comparison, record the hypothesis, baseline revision, frozen task hashes, one changed variable, observations, counterexamples, and keep/revise/drop decision. Once a failure informs a fix, that page becomes regression evidence.
- A candidate advances from this small batch only if it introduces no wrong direct actions, preserves final successes against its paired baseline, accepts useful positive cases, and improves latency or cost for the stated workload. A latency win requires better full-action median without a worse tail; a cost-only win must state its latency penalty. If results are mixed, retain the control and investigate the failures.
- Before SDK promotion, freeze a confirmation batch on at least three domains unused in action development, check overlap with earlier corpora, and rerun in another provider session. Zero observed errors on a small batch supports the next experiment, not a general safety claim.

## Implementation order

1. Add action task/capture definitions beside the existing System One scripts. Keep action labels distinct from extraction schemas. Freeze the first snapshots and graders before inference.
2. Adapt `decision-selection-benchmark.ts` to consume those captures and emit archived, paired results. Reuse `tree.ts`, `pick.ts`, and `client.ts`; do not copy a production pipeline into scripts.
3. Run hypothesis 1, inspect retrieval failures and wrong accepts, and change one variable per follow-up. Keep a clear record when a set becomes regression-only.
4. Add resettable live execution and deterministic outcome grading. Run hypothesis 2 with fallback and identity checks included in timing.
5. Run free-form and observed-action workflow baselines, then the untouched confirmation batch. Only then propose an SDK resolver change or a new opt-in API.

Cache healing, learned postcondition checks, APC versus AX, and early readiness are later experiments. Each needs its own control. None is required to begin the first snapshot comparison.

Relevant code: `packages/extension/services/actService.ts`, `services/decisions/{pipeline,pick,tree,args,cacheCheck}.ts`, `packages/sdk-ts/scripts/decision-selection-benchmark.ts`, and `decision-workflow-benchmark.ts`. The old selection runner uses fixture-specific DOM IDs and synthetic button/input eligibility; replace that capture logic before treating it as a live-page runner.
