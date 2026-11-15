---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
---

Replace the prototype decision observer with bounded single-target and complete-set selection, deterministic discovery, and fresh candidate evidence checks before returning. Preserve ordinary LLM fallback, cache behavior, scope, variables and cancellation. Remove the old model-based cache checker.
