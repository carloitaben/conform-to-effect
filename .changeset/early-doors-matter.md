---
"conform-to-effect": patch
---

Fixed `getConstraints` returning `{}` for `Schema.Class` schemas. The constraint walker now recurses into the inner struct AST of class declarations, extracting per-field constraints like `minLength`, `required`, and optionality.
