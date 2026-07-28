---
"conform-to-effect": patch
---

`customize` is now consulted at each leaf node during coercion instead of only at the top-level schema boundary, matching Valibot's per-field escape hatch. A `bigint` slot was added to `configureCoercion.type` for custom bigint string parsing.
