---
"conform-to-effect": patch
---

Widened `coerceFormValue` and `coerceStructure` return types from `Schema.ConstraintDecoder` to `Schema.Codec`, restoring `.pipe()`, `.check()`, `.annotate()`, and the full schema protocol on coerced schemas.
