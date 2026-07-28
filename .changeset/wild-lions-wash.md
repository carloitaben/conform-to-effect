---
"conform-to-effect": minor
---

Reworked the library around an AST rewriter instead of a value preprocessor, matching Conform's official Valibot and Zod integrations.

This is a breaking change for pre-1.0 users:

- Minimum Effect version raised from `4.0.0-beta.94` to `4.0.0-beta.102`. The `typeConstructor` annotation used for Date detection was removed upstream.
- `formatResult` type parameter changed from `<S extends Schema.ConstraintDecoder<unknown>>` to `<A>` for inference. Existing call sites pass through unchanged, but explicit type annotations need updating.
- `formatResult` error messages now use Effect's own defaults. Customize via `Schema.annotate({ message })` on individual checks.
- `formatResult` and `formatExit` `formatIssues` callback now receives raw `SchemaIssue.Issue` objects instead of pre-formatted `{ message, path }` items. Use `issue._tag` for i18n keying.
