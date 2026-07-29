# conform-to-effect

## 1.0.0

### Major Changes

- cdcd5ff: First stable release. The library provides Effect-native coercion and constraint derivation for Conform forms, matching the official Valibot and Zod adapters in behaviour and API shape.

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

## 0.2.1

### Patch Changes

- 4c2ec2e: Fixed `getConstraints` returning `{}` for `Schema.Class` schemas. The constraint walker now recurses into the inner struct AST of class declarations, extracting per-field constraints like `minLength`, `required`, and optionality.
- 4c2ec2e: Added `File`/empty file handling. Empty file inputs (`File { name: "", size: 0 }`) are now stripped to `undefined` in both `coerceFormValue` and `coerceStructure`, matching browsers' semantics for unselected file inputs. `accept` constraint is now derived from `Schema.File.annotate({ accept: "image/*" })`.
- 4c2ec2e: `customize` is now consulted at each leaf node during coercion instead of only at the top-level schema boundary, matching Valibot's per-field escape hatch. A `bigint` slot was added to `configureCoercion.type` for custom bigint string parsing.
- 4c2ec2e: Widened `coerceFormValue` and `coerceStructure` return types from `Schema.ConstraintDecoder` to `Schema.Codec`, restoring `.pipe()`, `.check()`, `.annotate()`, and the full schema protocol on coerced schemas.

## 0.2.0

### Minor Changes

- 57d80dd: Reworked the library around an AST rewriter instead of a value preprocessor, matching Conform's official Valibot and Zod integrations.

  This is a breaking change for pre-1.0 users:

  - Minimum Effect version raised from `4.0.0-beta.94` to `4.0.0-beta.102`. The `typeConstructor` annotation used for Date detection was removed upstream.
  - `formatResult` type parameter changed from `<S extends Schema.ConstraintDecoder<unknown>>` to `<A>` for inference. Existing call sites pass through unchanged, but explicit type annotations need updating.
  - `formatResult` error messages now use Effect's own defaults. Customize via `Schema.annotate({ message })` on individual checks.
  - `formatResult` and `formatExit` `formatIssues` callback now receives raw `SchemaIssue.Issue` objects instead of pre-formatted `{ message, path }` items. Use `issue._tag` for i18n keying.

### Patch Changes

- a5d8a8c: Added `formatExit` for async and effectful schemas. It mirrors `formatResult` but takes `Exit.Exit` from `Effect.runPromiseExit`, allowing `DecodingServices`, async filters, and Effect-based transformations in `validateSchema`.
- a5d8a8c: Improved form coercion coverage for unions, dates, records, and required compound fields.

  - Coercion codecs are now inserted at every schema leaf, so union branches coerce correctly and order-independently.
  - Date coercion now matches on Effect's stable `representation.id` instead of the deleted `typeConstructor` annotation.
  - Index signatures and `Schema.Record` now coerce values correctly.
  - Required compound keys missing from form data are now prefilled with `{}` or `[]` before validation, preventing spurious parent-field `required` errors.

- a5d8a8c: Rebuilt constraint derivation on Effect's stable `representation` annotations, replacing the internal `arbitrary.constraint` hints.

  This fixes `minLength` leaking onto arrays, exclusive bounds being ignored, `Date` and `BigInt` values surfacing as raw objects in HTML attributes, case-insensitive regex patterns, optional-schema constraints, and string-literal union patterns.

- a5d8a8c: Added schema coercion caching via `WeakMap`, so calling `coerceFormValue(schema)` inline on every render is cheap after the first call.
- a5d8a8c: Fixed double-decoding and completed root export parity.

  - `coerceStructure` no longer runs validation checks, and wrapping `Schema.NumberFromString` in `coerceFormValue` no longer throws `Expected string, got 42`.
  - `index.ts` now exports `coerceFormValue`, `coerceStructure`, and `configureCoercion`, matching the README's documented API surface.

- a5d8a8c: Cleaned up packaging metadata by removing the unnecessary `@conform-to/react` peer dependency and adding `sideEffects: false`, `homepage`, and `bugs` fields.
