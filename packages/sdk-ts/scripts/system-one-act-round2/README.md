# Act section retrieval replay

## Protocol fixed before scoring

Compare production at `c04b4c31e43154c3e420073ca368187e64bb0008` with an Act-only alternative that uses heading hierarchy, page landmarks, and local DOM text to find section-qualified actions. Use the same 30-click and 30-fill-target budgets. In the alternative, exact XPath aliases yield their first-pass slots to distinct controls when trimming to the budget. Keep distinct paths even when label and destination are identical. Preserve the production eligibility filters, DOM presentation order, complete action choices, literal argument extraction, confidence threshold, and execution guard. Measure a ranking-only ablation offline with alias prioritization and no context changes.

- Use the original Act development and confirmation captures as compatibility suites. They carry prior independent selector labels for click, fill, and negative cases. Exclude unavailable and unsupported operations.
- Use SQLite, GitHub README, and MDN section docs as section development. Freeze and score WCAG, Git switch, and Python tutorial as section confirmation. The six captures come from the round-two archive. The labels in `sections.json` were assigned by inspecting snapshot outline, XPath and DOM facts without running either ranker. Prefer visibly distinct occurrences and explicit scope. Unqualified negatives use different positions or sections even when destination matches. A negative request that names a nonexistent target in a section has no expected action even if another section offers that label.
- Replay the original Books and Shop catalog labels as stress cases. Their multi-target retrieval metrics describe coverage only. A whole-action judge should abstain on a request to act on multiple controls.

Report gold coverage at 1, 5 and 30, first-gold MRR at 30, and base/alternative shortlist losses. In the decision replay, compare exact method, physical target and literal arguments. Track correct accepts, abstentions, wrong accepts, and provider errors per case. Grade the selected action before the browser guard, with no browser or fallback calls. Use the existing Perplexity provider with its pinned `pplx-decider-v1.3` model, two rounds, alternating arm order. Run every section case and all available Act compatibility cases on public HTTPS captures. Report sections and compatibility separately. Archive hashes must match before selection.

Ship only if confirmation shows at least two more correct section accepts across paired rounds or at least two more distinct gold targets at the 30-slot production budget across positive section cases, with no gold shortlist loss on confirmation, no compatibility gold shortlist loss, and zero new wrong accepts on any evaluated case. A provider error prevents that pair from supporting promotion. The catalog stress results cannot substitute for single-action gains.

## Exploratory catalog follow-up

After inspecting the first Shop ranking, test one offline follow-up. Move repeated navigation links with the same name, destination, and named navigation landmark to a second pass when the instruction has no word in the link label and no navigation, placement, or ordinal cue. Retain every candidate in the full ranking. The Shop page exposes the same pagination above and below its product list. This follow-up was designed after seeing those candidates and is outside the promotion rule and live replay.

## Reproduce

Run from the repository root. Use the same archived captures and an existing Perplexity configuration for the live comparison.

```sh
study=packages/sdk-ts/scripts/system-one-act-round2
archive=/path/to/vendor-repos
bun "$study/replay.ts" "$archive"
bun --env-file=/path/to/existing.env "$study/replay.ts" "$archive" --live
pnpm exec vitest run packages/extension/tests/actionPlans.test.ts packages/extension/tests/actionGuard.test.ts packages/extension/tests/actionTarget.test.ts packages/extension/tests/act.test.ts
```

The runner checks snapshot and label digests against the archived manifests and checks the production baseline against the pinned revision. The alternative uses the production candidate eligibility, evidence, argument parser, and decision client. It replaces the nearest-heading field with XPath-scoped headings, adds bounded paragraph or record text and landmarks, and sends the same whole-action question. This compares retrieval and evidence together. Rank only determines which candidates reach the provider because the plans are presented in DOM order. The live runner emits JSON lines with outcome, confidence, token counts and request duration. It has no browser handle.

## Offline results

Counts show the number of labeled targets covered, with baseline and context results separated by a slash. MRR uses the first matching target per positive query. The alias-only arm matched the baseline at every measured cutoff.

| Split                | Targets |  At 1 |    At 5 |   At 30 |    MRR at 30 |
| -------------------- | ------: | ----: | ------: | ------: | -----------: |
| Act development      |      10 | 6 / 7 | 10 / 10 | 10 / 10 |  .737 / .800 |
| Act confirmation 1   |       5 | 3 / 4 |   5 / 5 |   5 / 5 |  .733 / .867 |
| Act confirmation 2   |       6 | 2 / 6 |   5 / 6 |   6 / 6 | .487 / 1.000 |
| Section development  |       9 | 5 / 5 |   8 / 8 |   9 / 9 |  .686 / .701 |
| Section confirmation |       9 | 2 / 6 |   8 / 8 |   9 / 9 |  .503 / .796 |
| Books stress         |      41 | 1 / 2 |  6 / 11 | 21 / 41 |  .444 / .778 |
| Shop stress          |      33 | 2 / 2 |   6 / 6 | 20 / 26 |  .681 / .682 |

The four additional rank-one hits on held-out documents were WCAG's FAQ and Summary links, and the Git Options and See Also occurrences of `git-checkout`. Every Act and section target was already reachable at the production cutoff. The archive excluded an unavailable government search, a select-option action, and a discovery case.

The Books title-link query rose from 0/20 to 20/20 at rank 30. The ranking recognized anchors in headings. Shop product details rose from 3/16 to 9/16. The exploratory pagination pass deferred the second copy of seven links and reached 16/16, with no observed shortlist loss elsewhere. This follow-up was measured offline on the same Shop page that motivated it.

## Provider replay

Two rounds on 62 frozen HTTPS cases produced 124 decisions per arm. All 60 repository Act tests passed. The 18 tests in `actionPlans.test.ts` cover complete action choices, guard behavior, and execution in fixtures.

| Split                | Positive decisions per arm | Correct accepts, baseline / context | Wrong accepts, baseline / context | Abstained, baseline / context |
| -------------------- | -------------------------: | ----------------------------------: | --------------------------------: | ----------------------------: |
| Act development      |                         20 |                             18 / 18 |                             0 / 0 |                       12 / 12 |
| Act confirmation 1   |                         10 |                               8 / 8 |                             2 / 0 |                         6 / 8 |
| Act confirmation 2   |                         12 |                             12 / 12 |                             0 / 0 |                         6 / 6 |
| Section development  |                         18 |                             18 / 16 |                             2 / 2 |                       10 / 12 |
| Section confirmation |                         18 |                             18 / 18 |                             2 / 0 |                       10 / 12 |
| **Total**            |                     **78** |                         **74 / 72** |                         **6 / 2** |                   **44 / 50** |

- In each round, production picked the wrong book for `books-title` and accepted a Git submodule link from Options when asked for it in See Also. The alternative abstained on both cases.
- Both arms accepted the MDN sidebar's Global attributes link on the unqualified request despite the second visible occurrence in the article body. The alternative's confidence increased on both erroneous picks. Keeping separate candidate paths does not guarantee that the provider recognizes ambiguity.
- The alternative abstained twice on the GitHub About READMEs heading permalink. Both arms offered the correct target. Production selected it twice. The alternative changed both the surrounding evidence and the other choices, so this run does not identify which change caused the abstention.
- The alternative used 332,974 input tokens against production's 278,282, an increase of 19.7%. Median provider duration was 631 ms against 630 ms. There were zero provider errors and zero new wrong accepts.

The alternative missed the promotion rule. Section confirmation gained no correct accepts and no targets at the production cutoff. Production Act retrieval and execution stay at the pinned implementation.

The replay outputs are archived locally under `system-one-study-2026-11-20/act-round2` in `vendor-repos`. The SHA-256 digests are `73893d5e0382f9edb3ca8af35ceb1eae4a5bea86b87577c23042adb8c34f7459` for `offline.json` and `7c43cd547c85348c28d90769b1cfe91201cd637f1380bcba3e6ebcbb9b70954a` for `provider.jsonl`.
