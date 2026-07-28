---
"conform-to-effect": patch
---

Fixed double-decoding and completed root export parity.

- `coerceStructure` no longer runs validation checks, and wrapping `Schema.NumberFromString` in `coerceFormValue` no longer throws `Expected string, got 42`.
- `index.ts` now exports `coerceFormValue`, `coerceStructure`, and `configureCoercion`, matching the README's documented API surface.
