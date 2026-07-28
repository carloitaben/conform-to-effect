---
"conform-to-effect": patch
---

Rebuilt constraint derivation on Effect's stable `representation` annotations, replacing the internal `arbitrary.constraint` hints.

This fixes `minLength` leaking onto arrays, exclusive bounds being ignored, `Date` and `BigInt` values surfacing as raw objects in HTML attributes, case-insensitive regex patterns, optional-schema constraints, and string-literal union patterns.
