# Act structural context replay

## Protocol fixed before scoring

Pin production to `aec9cb750`. Test an Act-only change for click and open requests that identify a native heading by name at the end of the instruction, and requests that explicitly ask for title links. Resolve a section only when the heading name is unique and agrees with a visible native DOM heading. Use the heading's parent and DOM order up to the next same-parent heading of equal or higher level. Keep frames separate and exclude nested navigation, sidebars and footers from prose scope. Prefer links with verified structural membership at the existing cutoff and give the provider a compact section membership fact. For explicit title-link requests, prefer native links inside or wrapping a visible heading and expose their title when it differs from the link name. Preserve eligibility, other evidence, option order, threshold, arguments and execution outside the changed route. Keep out-of-scope candidates eligible so the provider can weigh the evidence.

Freeze the Act cases in `holdout.json` against the existing Observe capture manifest. IANA, OpenStreetMap and PostgreSQL were outside the round-two Act study. The Books Travel category is a separate capture on a site used in development, so report it as a title-link control and exclude it from independent promotion metrics. Score exact click target, method and arguments. Report retrieval at 1, 5 and 30 separately. Compare actual production plans and decisions in two paired rounds, alternating arm order. Use the existing Perplexity configuration with `pplx-decider-v1.3`. Replay in process with no browser or action execution.

Require identical complete plans on nonactivated compatibility cases, zero lost gold at budget 30, zero lost correct accepts, and zero new wrong accepts on the paired holdout and legacy checks. Require either two additional correct accepts, two fewer wrong accepts, or two additional distinct gold targets offered at 30 on independent cases. Require the Books title-link stress case to retain its full round-two gain and total input tokens on independent changed cases to rise by at most 5%. Any provider error makes that pair ineligible for promotion. The legacy split and stress cases are diagnostic and cannot satisfy the independent improvement criterion.

## Second protocol

The first test added a Boolean to each link. The provider still chose the IANA footer's Protocols link twice. Production's linear AX heading gave the footer link the requested main-document heading. Test the same scope retrieval with evidence that corrects this heading. Use the requested section name for members and replace an inherited matching heading with a short outside-section marker for nonmembers. Keep other evidence as before. The provider retains the full offered choice set. Keep the title-link treatment for separate scoring.

Freeze a second holdout before replay. Use the earlier W3Schools iframe tutorial and the Weather Service About capture. Add three Django title-link controls from a prior capture excluded from the round-two candidate run. Django appeared in the old Act compatibility suite with different queries, so exclude its controls from the independent improvement threshold. Use the same promotion thresholds and two-round provider budget as before. Replay first-holdout and legacy changes afterward as compatibility, with no tuning against second-holdout results.

## Results

The Boolean version retained the full Books stress gain and recovered four title-link decisions on the Travel capture. Across the first holdout's changed section plans it preserved 12 correct accepts, reduced wrong accepts from three to two and increased input tokens by 7.5%. It missed the promotion rule.

The heading correction met the second protocol. The table includes only live pairs with changed provider plans. Unchanged cases are checked offline for exact plan equality.

| Split                      | Changed cases | Correct accepts before / after | Wrong accepts before / after | Abstentions before / after | Input tokens before / after |
| -------------------------- | ------------: | -----------------------------: | ---------------------------: | -------------------------: | --------------------------: |
| Reserved section holdout   |             3 |                          0 / 0 |                        6 / 4 |                      0 / 2 |             11,422 / 11,530 |
| First section holdout      |             5 |                          6 / 6 |                        3 / 2 |                      1 / 2 |             21,620 / 21,768 |
| Legacy sections            |             2 |                          2 / 2 |                        0 / 0 |                      2 / 2 |               9,266 / 9,284 |
| Books Travel title control |             2 |                          0 / 4 |                        0 / 0 |                      4 / 0 |              9,822 / 12,552 |
| Django title control       |             3 |                          6 / 6 |                        0 / 0 |                      0 / 0 |             14,136 / 14,954 |

Two rounds on the reserved holdout removed the same error twice. The provider stopped choosing a Weather Service social feed for a request that placed it in NWS Partners. It still chose the footer's Glossary and About Us links. In the first holdout, the candidate removed one erroneous Release Notes selection and still chose the IANA footer's Protocols link twice. No pair lost a correct accept or gained a wrong accept. All 60 live decisions completed without a provider error.

Rank-one section confirmation coverage rose from 2/9 to 4/9. All nine were offered at 30 in both arms. The reserved holdout kept 4/4 at 30 and 1/4 at rank one. The matched positive cases produced identical provider plans, and the leading article in the Weather.gov heading kept its positive case on the original route. The Books stress request retrieved 0/20 versus 20/20 at 30. That request asks for multiple links and was scored offline. The 32 prior compatibility requests produced identical plans, including the older unqualified Books request. The prior Git wrong accept also had an identical provider request in the legacy replay.

The title controls show a separate tradeoff. In this Books capture the new plans offered more relevant title links and averaged 683 extra input tokens per request. Section requests in the reserved split averaged 18 extra input tokens per changed request. The small split and repeated rounds limit conclusions about other pages. The replay grades System One before the execution guard and ordinary Act fallback.

## Reproduce

Run from the repository root with the pinned local capture archive. The runner prints JSON lines and verifies capture digests before scoring. Only changed plan pairs reach the provider. Use the repository's Act tests to exercise execution and refresh against local fixtures.

```sh
study=packages/sdk-ts/scripts/system-one-act-scope
archive=/path/to/vendor-repos
bun "$study/replay.ts" "$archive" --offline legacy
bun --env-file=/path/to/existing.env "$study/replay.ts" "$archive" --live holdout2
bun --env-file=/path/to/existing.env "$study/replay.ts" "$archive" --live holdout
bun --env-file=/path/to/existing.env "$study/replay.ts" "$archive" --live legacy
```

The local archive `system-one-study-2026-11-20/act-scope` contains the prototype and replay output. The table records SHA-256 digests for the promoted replay files.

| File                    | SHA-256                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| variant2-holdout2.jsonl | `8852bda4994be0a7cde687de761739deaf3f2b20e30d9d7c2fe4bb1aa5685055` |
| variant2-holdout.jsonl  | `93d507aaaa2c2b37c6096242a36c4d08aabff2e69fad31fde940bf9bef22f17d` |
| variant2-legacy.jsonl   | `08ae1031191be3e87614d430f10c94c6b293f5bf8074ffecda5b136eb1f11a58` |
