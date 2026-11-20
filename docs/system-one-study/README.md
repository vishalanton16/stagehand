# System One study

Base runtime `93b9d9132`, November 20, 2026. The study captures public pages in Chrome, freezes the Stagehand snapshot and independent labels, then replays identical inputs through the candidate policies. Public-page replay never executes a proposed action.

## Integrated results

The updated Observe route resolves explicit section-link requests from the DOM and revalidates the complete scoped result before returning. Extract can retry one uniquely scoped list group that the original shortlist omitted. Act can prioritize links with verified heading or title context and checks that context again before input. Unresolved cases retain ordinary inference.

| SDK comparison                                       |         Baseline | Integrated build |
| ---------------------------------------------------- | ---------------: | ---------------: |
| Targeted section tasks on live pages                 |    10/16 correct |    14/16 correct |
| Targeted section SDK latency, p50 / p95              | 5,000 / 8,223 ms |    61 / 2,315 ms |
| Targeted section model requests, decision / fallback |          54 / 12 |            0 / 2 |
| Controlled SDK acceptance, all operations            |    16/18 correct |    18/18 correct |
| Live SDK acceptance, all operations                  |      8/9 correct |      9/9 correct |

The live scoped comparison uses eight cases over two rounds. Both builds checked these cases on six public sites in separate runs. The updated build returned exactly the three IANA links both times, after the baseline returned 30. The two remaining errors came from ordinary fallback on the same WCAG section. The controlled SDK suite uses the same captured HTML across builds and checks real browser effects for Act on a loopback fixture. Luna passed 18/18 in both controlled runs. [SDK acceptance benchmark](../../packages/sdk-ts/scripts/system-one-sdk-acceptance/README.md)

The paired Extract run improved exact direct list results from 27/68 to 38/68 and reduced ordinary fallback routes from 44/88 to 36/88. The recovery path returned 10 exact results in 12 attempts with zero wrong accepts. Decision p50 rose from 855 to 985 ms. The final candidate passed 38/68 lists directly in a separate session, with 38/88 fallback routes across lists and scalars. Both runs rejected the GitHub qualifier whose accessibility text contains a space after the slash. [Extract replay](extract-round2.md)

The scalar precision check runs when a directly mapped integer lacks usable reader evidence and a competing excerpt contains a more precise spelling. On the NIST outline, both wrong Flash accepts of `273 K` routed to fallback with the check. Both still routed to fallback on the integrated candidate. Source-specific approximate requests, zero and absence passed their controls. The natural precision improvement came from one page. [Scalar replay](/Users/vishal/Developer/personal/forks/stagehand/vendor-repos/system-one-study-2026-11-20/scalar-precision/binary-results.jsonl)

The narrower Act route corrected the same Weather Service wrong selection in both reserved rounds by abstaining. The wider candidate reduced wrong accepts by four across 124 trials but lost two correct accepts and used 19.7% more input tokens. The narrower route preserved all previously correct selections in the tested splits. The Books Travel title controls gained four correct selections with 28% more input tokens. The reserved held-out gain is one distinct case. [Act replay](../../packages/sdk-ts/scripts/system-one-act-scope/README.md)

## Final build checks

All three arms passed 18/18 controlled SDK trials on the final build. The SDK p50 was 1,942 ms for ordinary Luna, 1,261 ms for Decider and 973 ms for Flash. Their p95 values were 3,418 ms, 2,954 ms and 3,017 ms. Each decision arm used four Luna fallbacks. The older frozen Observe replay had more Flash abstentions, so the existing default remains Decider. [Final SDK summary](/Users/vishal/Developer/personal/forks/stagehand/vendor-repos/system-one-study-2026-11-20/sdk-acceptance-integrated/summary.json)

The 82-task archived Extract run tested both builds and both Decider models once per task. It verified the grader source bytes against the archived copy and used one digest-pinned snapshot bundle for every arm. Each task rotated the order of the four calls. The replay includes old fixtures and previously scored public snapshots.

| Decision model and build | Correct direct | Wrong direct | Fallbacks | Decision p50 / p95 |
| ------------------------ | -------------: | -----------: | --------: | -----------------: |
| Decider baseline         |          60/82 |            2 |        20 |   1,042 / 2,264 ms |
| Decider final            |          61/82 |            2 |        19 |   1,124 / 2,948 ms |
| Flash baseline           |          44/82 |            5 |        33 |     671 / 1,224 ms |
| Flash final              |          47/82 |            5 |        30 |     710 / 1,514 ms |

The wider run reproduced the scoped list recoveries and Flash's NIST abstention. It also recorded different outcomes for Homebrew wget and the tallest-buildings list. A follow-up replay gave both builds identical captured provider responses in both directions. Both produced identical requests and outcomes on the two disputed cases. Latency includes decisions and local processing on reused snapshots. [Wide replay](/Users/vishal/Developer/personal/forks/stagehand/vendor-repos/system-one-study-2026-11-20/wide-extract-paired/results.jsonl) · [Transport equivalence](/Users/vishal/Developer/personal/forks/stagehand/vendor-repos/system-one-study-2026-11-20/extract-equivalence.jsonl)

Extension and SDK builds and typechecks passed. The final extension suite and seven browser smoke checks passed 1,514 tests, with three skips and nine existing todos. The smoke checks include a local scoped action whose DOM heading text changes while the accessible label stays cached.

## Research and benchmark index

- [Local Markdown inventory](notes-index.md) collects the original reports, experiments, transcripts and release notes scattered under `vendor-repos/`.
- [Historical audit](history.md) traces the earlier PRs, archived source and graders, and the results they support.
- [Provider review](providers.md) records the current contracts and which production and candidate routes passed live conformance.
- [Live capture and replay](../../packages/sdk-ts/scripts/system-one-study/README.md) has 16 labeled cases on eight pages. Two labels permit equivalent choices or require every duplicate. The cases include absence, scope, and nested frames.
- [Act retrieval](../../packages/sdk-ts/scripts/system-one-variants/README.md) compares ranks on fixed action candidates and labels.
- [Act section experiment](../../packages/sdk-ts/scripts/system-one-act-round2/README.md) measured denser pages and 124 provider decisions per arm. It improved rank-one recall on the section sample and reduced wrong accepts, with lower correct coverage and higher token use. The tested ranking stays in the experiment.
- [Exact-value audit](exact-value-audit.md) checks rendered DOM against accessibility text. GitHub's qualifier needs its original text, and exact offsets can still point to a different fact. The provider probe preserved this failure explicitly.

## Frozen Observe provider comparison

Same 16 cases, two interleaved rounds. Staged means the current Observe policy with each model's adapter. Ordinary means the current generative Observe service with Luna Responses, reasoning effort `none`. The exact grade checks selectors, methods, arguments and cardinality. Timing stops at the frozen result or abstention, before browser recapture or fallback.

| Model                                  | Exact / 32 | Non-exact returns | Abstained |     p50 / p95 |
| -------------------------------------- | ---------: | ----------------: | --------: | ------------: |
| Decider v1.3                           |         26 |                 2 |         4 | 1.40 / 3.38 s |
| Decider Flash v1.3                     |         22 |                 2 |         8 | 0.73 / 1.69 s |
| Jev 1.14                               |         20 |                 0 |        12 | 0.61 / 1.11 s |
| Clef Flash                             |          6 |                 0 |        26 | 0.24 / 0.88 s |
| Luna Decisions through Gateway         |         22 |                 0 |        10 | 0.92 / 1.95 s |
| Microsoft Decision-1.1 through Gateway |         10 |                 0 |        22 | 0.98 / 2.56 s |
| Ordinary Luna through Gateway          |         17 |                15 |         0 | 1.51 / 3.81 s |

Both Decider models returned all three requested IANA links plus 27 outside the section in both rounds. In a separate two-round diagnostic, ordinary Luna found the exact DOM targets on 32/32 and matched the entire action grade on 17/32. That gap is method or argument choice. All HTTP requests in the comparison returned 200. Clef Flash abstained on most cases, so its raw latency cannot predict the caller's time with fallback. The native providers shared fixed application gates. Their confidence calibration and effective coverage differ.

On three previously labeled archives, the one-request alternative offered all candidates, a method choice and a singular-target predicate on small pages. Across 64 cases per Decider model, the standard arm passed 58 and Flash passed 50. The one-request arms passed 14 and 6 respectively, with zero incorrect direct results. A simulated sequential cascade preserved those staged pass rates and worsened p95 on all six split/model comparisons. The small Jev pilot showed a stronger one-request signal. On the fresh set it resolved 4/32 cases directly and lifted its own simulated cascade from 20/32 to 22/32. This is insufficient coverage for a general dispatch change.

The Act selection pilot on nine archived cases passed 9/9 for both Decider models, six exact proposals and three correct abstentions each. The five-case ordered Extract pilot passed 2/5 directly for each. Both models fell back on the Kubernetes, MDN and GitHub cases. The local operation pilot records the task IDs and snapshot hashes for follow-up.

## Section scope holdout

The IANA failure is development evidence. Before replaying the structural selector, we captured six other public pages and fixed 10 labels in the [section manifest](../../packages/sdk-ts/scripts/system-one-study/section-manifest.json). The labels cover empty sections, lower-level subheadings, heading permalinks, and links in adjacent sections. The experimental route accepts only an explicit section-link request with a uniquely resolved heading and a defensible DOM boundary.

| Two rounds per arm                        | Exact / 20 | Wrong | Abstained | HTTP attempts | Input tokens | Replay p50 |
| ----------------------------------------- | ---------: | ----: | --------: | ------------: | -----------: | ---------: |
| Current selector                          |          2 |     0 |        18 |            60 |      432,638 |   2,458 ms |
| Structural selector with current fallback |         14 |     0 |         6 |            12 |       45,048 |       5 ms |

The unchanged IANA snapshot returned exactly three links with the structural route and zero model requests. The holdout prototype fell through on the empty SQLite section, the GitHub heading permalink and the MDN capture with unresolved controls. The integrated implementation accounts for heading permalinks and revalidates all links in the selected section.

## Reproduce

Raw public snapshots, replay receipts and summaries are in the local ignored `vendor-repos/` tree. The repository holds findings, graders and digests.

```sh
archive=vendor-repos/system-one-corpus/decisions-beta-93b9d9132-capture-v2
routing=packages/sdk-ts/scripts/system-one-routing
node --env-file=.env --import tsx "$routing/replay.ts" "$archive" /tmp/system-one-fresh 2 \
  pplx-decider-v1.3 pplx-decider-flash-v1.3 jev-1.14.0 clef-flash \
  openai/gpt-6-luna-decisions microsoft/decision-1.1 openai/gpt-6-luna
python3 "$routing/summarize.py" /tmp/system-one-fresh

study=packages/sdk-ts/scripts/system-one-study
STUDY_MANIFEST="$study/section-manifest.json" STUDY_LIVE=1 STUDY_ROUNDS=2 \
  node --env-file=.env --import tsx "$study/replay.ts" \
  vendor-repos/system-one-study-2026-11-20/section-capture runtime "./$study/section.ts"
```
