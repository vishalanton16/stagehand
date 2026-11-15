# Branch cleanup results

Partial commit scope, November 15: act/extract cleanup is committed separately. Observe retirement is deferred, including its controller/SDK documentation hunks and the legacy picker, tree, argument and action-pipeline dependencies it still imports. The full-cleanup design and validation below describe the complete working-tree candidate, not the narrower committed runtime. Existing observe behavior remains in the partial commit. Its replacement requires separate frozen-snapshot and live-page evidence.

The partial staged snapshot was validated independently: 2,622 unit/reference/parity tests, 49 artifact/browser tests and 1,115 Python tests passed. Extension/SDK/protocol TypeScript checks, schema/Python generation consistency, extension/SDK builds and scoped lint/format checks passed. The published cross-version network test was excluded. No new live model-quality comparison was run for the partial split.

Cleanup started from `9080038614bcaf5ee32afad44970f282ad0c73bd`, after the imported decision-model
stack and the recent extraction/action experiments. The scope and removal criteria are in
[cleanup_branch.md](../../../../../cleanup_branch.md). This is a cleanup report, not a release
certificate or a new independent accuracy benchmark.

## Current contract

```ts
const stagehand = await Stagehand.create({
  browser,
  model: fallbackModel,
  experimentalDecisions: {
    apiKey: process.env.PERPLEXITY_API_KEY!,
    model: "pplx-decider-v1.3",
  },
});

await stagehand.experimentalDecisions.act(instruction, { page });
await stagehand.experimentalDecisions.extract(instruction, schema, { page });
```

Provider defaults to Perplexity and model defaults to pinned `pplx-decider-v1.3`. Explicit Flash
selection uses `pplx-decider-flash-v1.3`. TypeSafe and Cloudflare remain supported adapters; callers
select their provider explicitly. Cloudflare requires an account ID or account-scoped endpoint.
Python has the same contract with snake_case names.

There are no public `plans`, `map`, confidence, verification, retry, readiness, tool-routing or
fallback switches. Obsolete options fail validation. Policy selection and mandatory checks are
internal. One supplied decision model applies to both action and extraction.

- Actions enumerate complete clicks and literal fills. Other operations or unresolved selections
  use the ordinary configured LLM. Selection checks identity, eligibility and evidence. Successful
  fills receive a read-back check.
- Extraction maps fields to records/facts, copies values, checks the schema and evidence, and uses
  one ordinary LLM extraction call when needed. Perplexity's bounded scalar reader uses the same
  validated transport as choices and predicates, including exact-span validation.
- Observation in the namespace delegates to ordinary LLM observation for compatibility.
- Ordinary Stagehand calls receive no experimental action configuration. Ordinary extraction keeps
  the previously measured single-call change.
- A decision key alone can resolve supported direct actions and extractions. Missing LLM credentials
  become an explicit error when fallback is needed. Observation always needs an LLM or gateway.

## Retained and retired code

The intent-first action tree, best/strict picker, old observer, completion judge, decision cache
checker, readiness loop and WebMCP decision routing are removed from the runtime. Their sources,
tests and measurements remain recoverable from the baseline archive. Independent browser/WebMCP
APIs and ordinary caching remain available.

Shared foundations remain where the recent implementation needs them: editable snapshot metadata,
outline parsing, contextual candidate descriptions, variable handling, provider adapters and answer
validation. Removing the imported merge wholesale would have removed these dependencies too.

The retained code separates action resolution, DOM facts, target checking, extraction schema
planning, list mapping, scalar mapping and acceptance. `mapCopy.ts` is now orchestration rather than
a combined implementation of all mapping policies. `outline.ts` serves deterministic extraction
without importing action policies. Shared configuration no longer lives in an action orchestrator.

Compaction, table binding, whole-page Locate and Clairic experiments live under
[`../experiments/`](../experiments/). They do not add controls to production services. Historical
ranking, speculation and policy controls load archived modules explicitly through
[`baseline.ts`](../baseline.ts). Current runtime replay arms use the retained production service.

### Action coverage after removal

| Operation or case                                              | Retained route                                              | Evidence                                                                                                |
| -------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Click, literal fill and declared variables                     | Complete-action selection, otherwise LLM                    | Paired live tasks, editor controls and variable/identity regressions.                                   |
| Hover, double-click and drag                                   | LLM fallback                                                | Three controlled SDK cases checked both method and DOM effect.                                          |
| Key press, scrolling, native/custom select and multi-step work | LLM fallback where a complete action is unavailable         | Existing action suite and short workflows.                                                              |
| Frames and shadow DOM                                          | LLM fallback when browser facts cannot represent the target | Existing frame/shadow tasks in the 40-task suite.                                                       |
| Disabled, readonly, hidden or changed targets                  | Reject before input                                         | Unit guards, readonly controls and injected mutations.                                                  |
| Cache replay and explicit self-heal                            | Existing execution with pre-input checks                    | Partial-sequence unit regressions and stale-target healing tasks. Semantic cache validity remains open. |

### Correctness fixes during cleanup

1. A failed check after possible input returns failure with the performed or attempted action. It
   does not repeat the instruction through LLM fallback or self-heal.
2. Cached sequences preserve earlier actions when a later step fails. Only a first-step pre-input
   rejection can trigger full re-inference.
3. An unresolved explicit target can self-heal before input. Scroll/keyboard target checks allow
   stale targets to be recognized before an executor is invoked.
4. LLM inference over a text node checks the snapshot identity of its parent element, because the
   executor trims the text-node XPath before input. The earlier guard compared different objects
   and rejected valid custom dropdowns.
5. The selected action carries its expected backend identity into the final execution check.
6. Decision usage includes the resolved provider/model, including billed replies rejected during
   validation. Public result metadata still aggregates token counts across model families; logs
   retain provider-attributed decision usage separately.

These changes use general node identity and execution state. There are no domain, task-name or
answer-specific branches in production code.

## Validation results

All task definitions and graders stayed fixed. Cases used to diagnose fixes are regression evidence.
The source hashes in each run distinguish the measured builds from later formatting and documentation.
The [committed aggregate](../results/cleanup-2026-11-15.json) records scored totals, exclusions and
manifest hashes. Raw runs are under `vendor-repos/system-one-corpus/runs/cleanup/2026-11-15/`.

| Check                                          | Result                                  | Interpretation                                                                                                     |
| ---------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Existing action suite, archived implementation | 32/40                                   | Archived complete-action policy with Decider, not the older intent tree.                                           |
| Existing action suite, first cleanup run       | 30/40                                   | Exposed stale-scroll healing and the inherited text-node identity error.                                           |
| Targeted action follow-up                      | 5/6                                     | Fixed controls and frame case passed. Nonsense instruction still failed this run.                                  |
| Existing action suite, final cleanup run       | 36/40                                   | All four remaining failures also failed on the archived baseline. Separate live sessions; no causal latency claim. |
| Nine-task live action workload                 | Decider 9/9, Luna 9/9                   | Repeated confirmation workload, not fresh held-out evidence.                                                       |
| Controlled stale targets                       | Decisions safely rejected 4/4; Luna 0/4 | Same-XPath replacement and same-node repurposing.                                                                  |
| Two short workflows, twice each                | Decisions 4/4; Luna 4/4                 | Todo create/complete/filter and Django tutorial navigation.                                                        |
| Editor and readonly controls                   | Default Decider 3/3; explicit Flash 3/3 | Plaintext/nested editors and readonly refusal through the SDK.                                                     |
| Decision-key-only SDK smoke                    | Passed                                  | Direct fill/extract worked without an LLM; unsupported action and observation failed clearly.                      |
| Provider live conformance                      | 3/3                                     | TypeSafe Jev, Cloudflare Clef and Perplexity Decider wire conformance.                                             |
| SDK extraction fixtures                        | Decider 6/6; Flash 6/6; Luna 6/6        | Controlled schemas, absence, zero, URLs, grouping and nested fallback.                                             |
| Frozen extraction replay                       | Baseline 80/82; cleaned 79/82           | Same snapshots and graders. The additional failure was LLM output variation on the same fallback request.          |

The four remaining action-suite failures are `bidnet`, `multi_tab`, `tab_handling` and
`vantechjournal`. Preserve them as open workflow/environment investigations. The nonsense-action
grader checks only returned success. The baseline passed while still performing an initial click,
so a passing score there does not establish safe abstention.

The extraction replay used one round per arm with concurrency four. Baseline accepted 63 results
directly and used fallback 19 times. The cleaned path accepted 65 directly and used fallback 17
times. Each had one wrong direct acceptance. The common failing tasks were the known NIST
ambiguity and GitHub qualifier source/format case. No claim of zero wrong accepts is made here.

The additional cleaned failure was `hold5_tld_list`: both implementations escalated before making
a decision request, but one Luna reply returned newline-joined labels inside an array element. An
offline probe confirmed identical fallback request parameters and identical handling of a fixed
reply. Its source and result remain in `tld-fallback-equivalence.mts` and
`tld-fallback-equivalence.json` in the raw cleanup directory. Do not silently remove this scored
failure or turn the comparison into an extraction accuracy win.

The first `operation-fallbacks/` run had malformed HTML event-handler attributes and is excluded
from product conclusions. Its source, manifest and failed results are preserved. The corrected
`operation-fallbacks-valid/` run validates handler compilation before inference and passed all
three operations. The two setup-only attempts to start the baseline suite failed before scoring;
`action-suite-baseline-2/` is the scored baseline.

Seven tasks lacked snapshots and were excluded before inference. Their names are recorded in the
aggregate and `extraction-selection.json`. The paired replay archive is
`runs/archive/eeeced6e-f896-4cf2-95bb-16ca9cb29431/` under the vendor corpus. Models were pinned;
provider sampling, caching and separate live sessions still limit numerical comparisons.

Automated checks passed: 1,300 extension/understudy tests, 1,231 SDK/protocol/parity tests,
47 TypeScript browser-runtime tests, 52 SDK-reference tests and 422 Python generated/client tests.
Extension checks retained three skips and nine todos; browser-runtime checks retained four skips.
TypeScript checks, Python lint/types and generated-file consistency passed. Extension/SDK builds,
Mint build validation, formatting and lint passed. The linter reports the repository's compiler-option
warning for the eval initializer. The final rebuilt SDK smoke confirmed key-only direct resolution
and clear failures when fallback credentials are absent.

## Historical source and evidence

Every existing Markdown file is retained. Dated results remain in the research docs, with current
status pointers. Public docs and changesets describe the retained behavior rather than the removed
prototype switches.

Before deletion, an inventory recorded 2,432 evidence files totaling 722,125,690 bytes, including
source archives, snapshots, screenshots, graders, usage and the two supplied transcripts. A final hash check found no changes or missing files among the 2,419 raw evidence files; the other
13 inventory entries are research Markdown with current-status notes. All 88 previously tracked
Markdown files still exist. The raw evidence stays in its original gitignored locations. A local archive is not an external backup.

The complete pre-cleanup source archive is
`vendor-repos/system-one-corpus/runs/cleanup/2026-11-15/baseline-complete-source.tar.gz`, SHA-256
`0c8bbe9b9f84307092f07be780b50a2c5f2fb0e44d478ed5098b01851a9c30b0`. The earlier source archive
and SDK-metadata supplement are also retained. `evidence-inventory.json.gz` records original paths,
byte counts and hashes; `baseline-manifest.json` records the baseline and dependency-lock hashes.

Restore the historical runtime from its recorded revision, without adding it to the production
import graph:

```sh
node --import tsx packages/sdk-ts/scripts/system-one/prepareBaseline.ts
pnpm exec vite build --config vendor-repos/system-one-corpus/runs/cleanup/2026-11-15/baseline/packages/extension/vite.config.ts
```

The preparation script restores tracked source and links installed dependencies. It points the
historical SDK and extension at the historical protocol, so current validation cannot silently
change a baseline. It never checks out a branch or rewrites current source. Preserve the raw corpus
separately when moving to another machine.

## Current reproduction

Every scored live command requires a new output directory.

```sh
pnpm --filter @browserbasehq/stagehand-extension build
node --env-file=.env --import tsx packages/sdk-ts/scripts/system-one/cleanupActions.ts cleaned vendor-repos/system-one-corpus/runs/cleanup/new-actions
node --env-file=.env --import tsx packages/sdk-ts/scripts/system-one/cleanupActions.ts baseline vendor-repos/system-one-corpus/runs/cleanup/new-baseline
node --env-file=.env --import tsx packages/sdk-ts/scripts/system-one/cleanupSmoke.ts vendor-repos/system-one-corpus/runs/cleanup/new-key-only
```

`CLEANUP_TASKS` selects existing action-task names, `CLEANUP_CONCURRENCY` controls concurrency, and
`CLEANUP_MODEL` selects the decision model. The full-suite runner caps each action at 40 seconds
and each task at 120 seconds. Verification extraction uses ordinary Luna in every action arm to
avoid mixing two experimental policies in the action score.

For extraction, use replay arms `baseline-decider,runtime-decider`, pin the frozen task list through
`REPLAY_TASKS`, and select only existing snapshots before inference. Historical speculation/ranking
arms require the prepared archive. The compaction probe adapts LLM input in the benchmark; it does
not require a production compaction flag.

## Remaining work

This cleanup does not prove full feature parity or release readiness. Investigate the four failing
action workflows, semantic cache correctness and ambiguous/non-action requests. Keep the known
extraction wrong accepts visible. Run fresh compaction and table-cell comparisons before promoting
those candidates, and calibrate providers independently. Go SDK changes require separate external
verification; this branch updates the TypeScript/Python contract.

No release, push, PR creation or history rewrite was performed.
