---
"conform-to-effect": minor
---

Reworked the entire library to use an AST rewriter instead of a value preprocessor, matching the architecture of Conform's official Valibot and Zod integrations.

## Breaking changes

- Minimum Effect version raised from `4.0.0-beta.94` to `4.0.0-beta.102`. The `typeConstructor` annotation used for Date detection was removed upstream.
- `formatResult` type parameter changed from `<S extends Schema.ConstraintDecoder<unknown>>` to `<A>` for inference. Existing call sites pass through unchanged, but explicit type annotations need updating.
- `formatResult` error messages now use Effect's own defaults. Customize via `Schema.annotate({ message })` on individual checks.
- `formatResult` and `formatExit` `formatIssues` callback now receives raw `SchemaIssue.Issue` objects instead of pre-formatted `{message, path}` items. Use `issue._tag` for i18n keying.

## Features

- **AST rewriter**. Coercion codecs are now inserted at every schema leaf, so union branches coerce correctly and order-independently.
- **Date coercion restored**. `isDateAst` now matches on Effect's stable `representation.id` instead of the deleted `typeConstructor` annotation, fixing breakage on `effect@4.0.0-beta.102+`.
- **`Record` coercion**. Index signatures and `Schema.Record` now coerce values correctly.
- **Caching**. Coerced schemas are memoised via `WeakMap`, so calling `coerceFormValue(schema)` inline on every render is cheap after the first call.
- **Constraint derivation rebuilt** on Effect's stable `representation` annotations, replacing the internal `arbitrary.constraint` hints. Fixes: `minLength` leaking onto arrays, exclusive bounds ignored, `Date`/`BigInt` values surfacing as raw objects in HTML attributes, case-insensitive regex patterns.
- **Improved error messages**. Check failures now produce Effect's native messages (e.g. `Expected number, got "12"`).
- **`formatExit`** added for async / effectful schemas. Mirrors `formatResult` but takes `Exit.Exit` from `Effect.runPromiseExit`, allowing `DecodingServices`, async filters, and Effect-based transformations in `validateSchema`.
- **Nested-key prefill**. Required compound keys (nested structs, arrays) missing from form data are now prefilled with `{}` or `[]` before validation, preventing spurious `required` errors on parent fields.
- **String-literal union patterns**. `Schema.Literals(["a","b"])` and `Schema.Enum` now emit a `pattern` constraint in `getConstraints`.
- **Exports now destructured** from the default `configureCoercion()` instance, sharing its cache.

## Fixes

- **Double-decode eliminated**. `coerceStructure` no longer runs validation checks, and wrapping `Schema.NumberFromString` in `coerceFormValue` no longer throws `Expected string, got 42`.
- **`Schema.optional(X)` constraints** now correctly report `required: false` and preserve `minLength`/`maxLength`/etc. from the inner schema.
- **Root export parity**. `index.ts` now exports `coerceFormValue`, `coerceStructure`, and `configureCoercion` (was previously only in `future.ts`), matching the README's documented API surface.
- **Packaging**. Removed unnecessary `@conform-to/react` peer dependency, added `sideEffects: false`, `homepage`, and `bugs` fields.
