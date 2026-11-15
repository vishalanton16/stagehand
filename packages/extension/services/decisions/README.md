# Decisions, experimental

Configure `experimentalDecisions` with provider credentials and an optional model. The explicit
namespace selects the retained policies internally. Ordinary Stagehand methods do not use it.

```ts
experimentalDecisions: {
  apiKey: process.env.PERPLEXITY_API_KEY!,
  model: "pplx-decider-v1.3",
}
```

- `act()` enumerates complete clicks and literal fills with contextual evidence and explicit
  abstention. Other operations or uncertain selections use the configured LLM. Selected targets
  receive identity, eligibility and evidence checks. A failure after possible input returns a
  failure without repeating the instruction. Supported fills receive a read-back check.
- `extract()` builds record groups and facts, maps fields, copies values with provenance, and
  validates the schema and evidence. Perplexity supplies a bounded Locate second reading for
  scalars. Unsupported schemas or disagreements use a single ordinary LLM extraction call.
- `observe()` retains the existing decision-model implementation with LLM fallback.

Perplexity is the default provider, pinned to `pplx-decider-v1.3`. Explicit Flash selection uses
`pplx-decider-flash-v1.3`. TypeSafe defaults to `jev-1.14.0`; Cloudflare defaults to `clef` and needs
an account ID or account-scoped endpoint override. Different providers do not have identical
coverage or calibrated probabilities. An ordinary model or gateway is still needed for fallback.

## Modules

| Module                                                | Responsibility                                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `act.ts`, `actionPlans.ts`                            | Resolve complete action choices.                                                    |
| `actionFacts.ts`, `actionTarget.ts`, `actionGuard.ts` | Browser evidence, selected-target stability and execution eligibility.              |
| `outline.ts`, `tree.ts`, `args.ts`                    | Snapshot parsing, candidate descriptions, grounded literals and variable redaction. |
| `extract.ts`, `mapCopy.ts`                            | Extraction acceptance and mapping orchestration.                                    |
| `extractionSchema.ts`, `extractionShared.ts`          | Supported schemas and shared copying/question helpers.                              |
| `listMapping.ts`, `scalarMapping.ts`, `dataView.ts`   | List mapping, scalar mapping, deterministic records and facts.                      |
| `scalarReader.ts`, `providers.ts`, `client.ts`        | Optional exact-span reading and shared validated provider transport.                |
| `config.ts`                                           | Internal configuration and policy constants.                                        |

Provider requests share answer validation, aliases, limits, cancellation, timeouts, retry and circuit
breakers. Locate validates spans against the supplied text. Provider usage is recorded even when
answer validation fails. Result usage includes decision and fallback work; logs retain the decision
provider's usage separately. Public usage metadata still aggregates tokens across model families.

The act service no longer uses the historical intent tree or best/strict picker. The existing
decision observer still imports that legacy dependency chain, retained until observe is evaluated.
The completion judge and model cache checker are retired. Editable metadata, shared transport and helpers
needed by the recent policies remain. Public prototype flags are rejected rather than ignored.

Table-cell selection, compaction and native-reader experiments live in the SDK research scripts.
They do not add switches to production services. Evidence, historical sources and measured
limitations remain in [the research index](../../../sdk-ts/scripts/system-one/docs/INDEX.md) and
[cleanup results](../../../sdk-ts/scripts/system-one/docs/CLEANUP_RESULTS.md).
