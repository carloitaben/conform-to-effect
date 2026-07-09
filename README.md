# conform-to-effect

[Conform](https://github.com/edmundhung/conform) helpers for integrating with [Effect](https://effect.website/).

> Warning
> Early project. Expect rough edges.

## Install

```sh
npm install effect@beta @conform-to/react conform-to-effect
```

## Quick Start

```ts
import { Result, Schema } from "effect"
import { coerceFormValue, formatResult } from "conform-to-effect"

const schema = coerceFormValue(
  Schema.Struct({
    age: Schema.optional(Schema.Number),
    subscribed: Schema.Boolean,
  }),
)

const result = Schema.decodeUnknownResult(schema)({
  age: "42",
  subscribed: "on",
})

if (Result.isSuccess(result)) {
  result.success
  // { age: 42, subscribed: true }
}

formatResult(result)
```

Prefer [`configureForms`](https://conform.guide/api/react/future/configureForms) for less boilerplate:

```ts
import { configureForms } from "@conform-to/react/future"
import { Schema } from "effect"
import {
  coerceFormValue,
  formatResult,
  getConstraints,
  isSchema,
} from "conform-to-effect"

const {
  FormProvider,
  useField,
  useForm,
  useFormMetadata,
  useIntent,
} = configureForms({
  isSchema,
  getConstraints,
  validateSchema(schema, payload) {
    const result = Schema.decodeUnknownResult(coerceFormValue(schema))(payload)

    return formatResult(result, {
      includeValue: true,
    })
  },
})

const signupSchema = Schema.Struct({
  email: Schema.String,
  age: Schema.optional(Schema.Number),
  subscribed: Schema.Boolean,
})

function SignupForm() {
  const { form, fields } = useForm(signupSchema)

  return (
    <form id={form.id} onSubmit={form.onSubmit} noValidate>
      <input name={fields.email.name} defaultValue={fields.email.defaultValue} />
      <input name={fields.age.name} defaultValue={fields.age.defaultValue} />
      <input
        type="checkbox"
        name={fields.subscribed.name}
        defaultChecked={fields.subscribed.defaultChecked}
      />
    </form>
  )
}
```

## API

Exports:

- `coerceFormValue`
- `coerceStructure`
- `configureCoercion`
- `formatResult`
- `getConstraints`
- `isSchema`

### `coerceFormValue`

Wrap an Effect schema so raw form values are coerced before normal validation runs.

- Strips empty strings to `undefined`
- Coerces strings into `number`, `boolean`, `date`, and `bigint`
- Still runs the original schema validation after coercion

```ts
import { Schema } from "effect"
import { coerceFormValue } from "conform-to-effect"

const schema = coerceFormValue(
  Schema.Struct({
    age: Schema.optional(Schema.Number),
    subscribed: Schema.Boolean,
    createdAt: Schema.Date,
  }),
)

const value = Schema.decodeUnknownSync(schema)({
  age: "",
  subscribed: "on",
  createdAt: "2026-01-01T12:00:00.000",
})

// { age: undefined, subscribed: true, createdAt: new Date("2026-01-01T12:00:00.000Z") }
```

### `coerceStructure`

Read current form data as typed structure without running validation rules.

- Coerces strings into typed values
- Skips validation, defaults, and transforms
- Uses fallback values like `NaN`, `false`, `Invalid Date`, and `0n` when coercion fails

```ts
import { Schema } from "effect"
import { coerceStructure } from "conform-to-effect"

const schema = coerceStructure(
  Schema.Struct({
    title: Schema.String,
    age: Schema.Number,
    subscribed: Schema.Boolean,
  }),
)

const value = Schema.decodeUnknownSync(schema)({
  title: "",
  age: "abc",
  subscribed: "",
})

// { title: "", age: NaN, subscribed: false }
```

### `configureCoercion`

Create customized coercion helpers for project-specific string handling.

- Override empty-string stripping
- Override string-to-`number` / `boolean` / `date` coercion
- Returns configured `coerceFormValue` and `coerceStructure`
- `customize` can override coercion at the wrapped schema boundary

```ts
import { Result, Schema } from "effect"
import { configureCoercion } from "conform-to-effect"

const { coerceFormValue } = configureCoercion({
  stripEmptyString: (value) => {
    const trimmed = value.trim()
    return trimmed === "" ? undefined : trimmed
  },
  type: {
    number: (text) => Number(text.replace(/,/g, "")),
  },
})

const schema = coerceFormValue(
  Schema.Struct({
    price: Schema.Number,
  }),
)

const result = Schema.decodeUnknownResult(schema)({
  price: "1,234",
})

if (Result.isSuccess(result)) {
  result.success.price
  // 1234
}
```

### `formatResult`

Convert an Effect decode result into Conform's form error shape.

- Success returns `null` by default
- Failure becomes `{ formErrors, fieldErrors }`
- `includeValue: true` also returns the parsed value

```ts
import { Schema } from "effect"
import { coerceFormValue, formatResult } from "conform-to-effect"

const schema = coerceFormValue(
  Schema.Struct({
    age: Schema.Number,
  }),
)

const result = Schema.decodeUnknownResult(schema)({
  age: "abc",
})

const submission = formatResult(result)

// {
//   formErrors: null,
//   fieldErrors: { age: ["form_error_invalid_type"] }
// }
```

### `getConstraints`

Derive native HTML validation attributes from an Effect schema.

- Returns field constraints like `required`, `minLength`, `maxLength`, `min`, `max`, and `pattern`
- Useful for wiring schema constraints into Conform metadata
- Returns `undefined` for non-schema input

```ts
import { Schema } from "effect"
import { getConstraints } from "conform-to-effect"

const Article = Schema.Struct({
  title: Schema.String.check(Schema.isMinLength(5), Schema.isMaxLength(20)),
})

const constraints = getConstraints(Article)

// { title: { required: true, minLength: 5, maxLength: 20 } }
```

### `isSchema`

Check whether a value is an Effect schema.

- Returns `true` for valid Effect schemas
- Narrows unknown values to schema values
- Handy before calling `getConstraints` on dynamic input

```ts
import { Schema } from "effect"
import { getConstraints, isSchema } from "conform-to-effect"

const value: unknown = Schema.String

if (isSchema(value)) {
  const constraints = getConstraints(value)
}
```

## Notes

- This package is shaped after Conform's future schema helpers, but implemented for Effect schemas.
- `coerceStructure` is intentionally structural: it skips validation checks and is meant for reading form state, not validating submissions.
- `configureCoercion().customize(...)` currently applies at the wrapped schema boundary, not per nested sub-schema.
