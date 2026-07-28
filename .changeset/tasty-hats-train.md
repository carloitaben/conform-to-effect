---
"conform-to-effect": patch
---

Added schema coercion caching via `WeakMap`, so calling `coerceFormValue(schema)` inline on every render is cheap after the first call.
