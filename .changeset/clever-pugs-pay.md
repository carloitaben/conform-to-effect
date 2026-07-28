---
"conform-to-effect": patch
---

Improved form coercion coverage for unions, dates, records, and required compound fields.

- Coercion codecs are now inserted at every schema leaf, so union branches coerce correctly and order-independently.
- Date coercion now matches on Effect's stable `representation.id` instead of the deleted `typeConstructor` annotation.
- Index signatures and `Schema.Record` now coerce values correctly.
- Required compound keys missing from form data are now prefilled with `{}` or `[]` before validation, preventing spurious parent-field `required` errors.
