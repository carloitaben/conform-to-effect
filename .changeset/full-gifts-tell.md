---
"conform-to-effect": patch
---

Added `File`/empty file handling. Empty file inputs (`File { name: "", size: 0 }`) are now stripped to `undefined` in both `coerceFormValue` and `coerceStructure`, matching browsers' semantics for unselected file inputs. `accept` constraint is now derived from `Schema.File.annotate({ accept: "image/*" })`.
