# Architecture

## Intent

Stagehand should treat System One models as **decision / mapping models**, not as free-form extractors.

1. Stagehand builds a structured view of the page.
2. The model picks groups, fields, sections and counts.
3. Stagehand **copies** values from the snapshot.
4. On disagreement or structural failure, fall back to one System Two model (Luna / configured LLM).

Values should come from the page. The model should not invent text.

## Request path (`extract: "map"`)

```
stagehand.experimentalDecisions.extract(...)
  → extractService.extract
      → mapCopyExtract (decisions/mapCopy.ts)
          → buildDataView (decisions/dataView.ts)
          → decide() questions (choice / noul; Locate via scalarReader when Perplexity)
          → copy values + provenance into data + trace
          → verdict.problems
      → if schema-valid && problems empty → return
      → else LLM extract (or abstain if llmFallback: false)
```

Config surface (`ExperimentalDecisionsConfig`):

```ts
experimentalDecisions: {
  provider: "perplexity", // or typesafe / cloudflare
  apiKey: "...",
  model: "pplx-decider-latest",
  extract: "map",
  // llmFallback: false → throw instead of Luna
}
```

## Code map

| Piece | Location |
| --- | --- |
| Data view | `packages/extension/services/decisions/dataView.ts` |
| Map-and-copy | `packages/extension/services/decisions/mapCopy.ts` |
| Locate / scalar second read | `packages/extension/services/decisions/scalarReader.ts` (Perplexity only) |
| Production gate | `packages/extension/services/extractService.ts` (`extract === "map"`) |
| Mode enum | `packages/protocol/schemas.ts` (+ `stagehand.v4.json`, generated Python) |
| Benchmark re-exports | `packages/sdk-ts/scripts/system-one/{dataView,mapCopy}.ts` |
| Arms | `packages/sdk-ts/scripts/system-one/arms.ts` (`runtime-decider`, `s1-*`, `map-*`, `agree-*`) |
| Replay / live | `replay.ts`, `live.ts`, heldout*.ts, corpus.ts |

Production and replay must share the extension modules. Do not fork logic back into the scripts.

## Data view responsibilities

Deterministic, no model:

- sibling record groups with aligned slots (`role[ordinal]` paths)
- table headers by position
- section / separator context
- merge of same-shaped groups across sections, then **heading-scoped sub-groups**
- distinct labels when separate tables share headers (`table N of M …`)
- `~first` slot option when a cell contains a list of aliases
- labelled facts for scalars
- URL map lookups for link fields

## Map-and-copy responsibilities

Model questions + copy code:

- pick the record group (choice + pointwise noul cross-check)
- map each schema field to a slot
- optional count / section / range questions from the instruction
- number-position disambiguation inside multi-number cells
- copy, fill-down for sparse columns, residual / fitExample helpers
- scalars: fact choice, optional record path, optional Locate check (`readerChecks`)
- collect `problem` trace entries → `verdict.problems`

Gate inputs that should trigger fallback:

- `group-disagree:*`
- `scalar-disagree:*`
- `count-short:*`
- `missing:*` / empty required fields
- schema mismatch / thrown `unresolved:*`

Production only runs structural verification. The replay-only yes/no self-check remains available through `askVerifier`.

## Provider differences

| Provider | Choice / noul mapping | Scalar second reading |
| --- | --- | --- |
| Perplexity Decider / Flash | yes | Locate via `scalarReader` |
| TypeSafe Jev | yes | none |
| Cloudflare Clef | yes | none (Clairic is a separate native path) |

`"native"` mode (Clairic / Decider extractive APIs) remains a different product surface from `"map"`.

## Provenance

Traces should carry source node IDs and record IDs for copied values. Provenance answers "where did this string come from?". It does not answer "is this the right field?" or "are these all the right records?".

## Related modes (do not confuse)

| Mode | Role |
| --- | --- |
| `off` | No decision extract path |
| `judge` | LLM extracts; decision model judges completion |
| `pick` | Decision model picks DOM nodes; code copies (older design) |
| `native` | Provider-native extract (Clairic / Decider extract) |
| **`map`** | **Record groups + mapping questions + copy + LLM fallback** |
