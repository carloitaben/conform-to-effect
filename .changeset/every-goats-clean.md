---
"conform-to-effect": major
---

First stable release. The library provides Effect-native coercion and constraint derivation for Conform forms, matching the official Valibot and Zod adapters in behaviour and API shape.

### Architecture

An AST rewriter inserts coercion codecs at every schema leaf. Unions resolve correctly and order-independently. Results are cached per schema via `WeakMap`, safe to call inline on every render.

### Constraints

Derived from Effect's stable `representation` annotations. Covers `minLength`, `maxLength`, `min`, `max`, `step`, `multiple`, `pattern`, `required`, and `accept`. Handles `Schema.Class`, `Schema.Enum`, string-literal unions, optional/nested fields, and index signatures.

### Formatting

`formatResult` and `formatExit` map Effect parse results into Conform's error shape. The `formatIssues` callback receives raw `SchemaIssue.Issue` objects with their `_tag` for i18n keying. Effect's own default messages are used unless overridden via `Schema.annotate({ message })`.

### Breaking from 0.2.0

- `CoercedFormSchema` and `CoercedStructureSchema` widened from `Schema.ConstraintDecoder` to `Schema.Codec`. Coerced schemas are now full schemas supporting `.pipe()`, `.check()`, and `.annotate()`.
- `configureCoercion.type` gained a `bigint` slot. The default is `BigInt`. Previously bigint coercion was hardcoded and not configurable.
- `configureCoercion.customize` is now consulted at each leaf node during coercion instead of only at the top-level schema boundary.
- `getConstraints` now extracts constraints from `Schema.Class` schemas.
- `accept` constraint is derived from `Schema.File.annotate({ accept: "…" })`.
