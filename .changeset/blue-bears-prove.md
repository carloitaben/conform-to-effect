---
"conform-to-effect": patch
---

Added `formatExit` for async and effectful schemas. It mirrors `formatResult` but takes `Exit.Exit` from `Effect.runPromiseExit`, allowing `DecodingServices`, async filters, and Effect-based transformations in `validateSchema`.
