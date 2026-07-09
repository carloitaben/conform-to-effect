import { Result, Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
  coerceFormValue,
  coerceStructure,
  configureCoercion,
  formatResult,
  getConstraints,
  isSchema,
} from "../src/index.js"

describe("public api", () => {
  it("exports the future helpers", () => {
    const schema = Schema.Struct({ age: Schema.Number })
    const wrapped = configureCoercion().coerceFormValue(schema)

    expect(isSchema(schema)).toBe(true)
    expect(isSchema(wrapped)).toBe(true)
    expect(coerceFormValue(schema)).not.toBe(schema)
    expect(coerceStructure(schema)).not.toBe(schema)
    expect(getConstraints(schema)?.age?.required).toBe(true)
  })

  it("formats schema failures into conform form errors", () => {
    const schema = Schema.Struct({ age: Schema.Number })
    const result = Schema.decodeUnknownResult(schema)({ age: "12" })

    expect(formatResult(result)).toEqual({
      formErrors: null,
      fieldErrors: {
        age: ["form_error_invalid_type"],
      },
    })
  })

  it("coerces form values before validation", () => {
    const schema = coerceFormValue(
      Schema.Struct({
        age: Schema.optional(Schema.Number),
        subscribed: Schema.Boolean,
        createdAt: Schema.Date,
        amount: Schema.BigInt,
      }),
    )
    const result = Schema.decodeUnknownResult(schema)({
      age: "",
      subscribed: "on",
      createdAt: "2026-01-01T12:00:00.000",
      amount: "42",
    })

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success).toEqual({
        age: undefined,
        subscribed: true,
        createdAt: new Date("2026-01-01T12:00:00.000Z"),
        amount: 42n,
      })
    }
  })

  it("coerces structural values without requiring full form shape", () => {
    const schema = coerceStructure(
      Schema.Struct({
        title: Schema.String,
        tasks: Schema.Array(Schema.Number),
        nested: Schema.Struct({
          note: Schema.optional(Schema.String),
        }),
      }),
    )
    const result = Schema.decodeUnknownResult(schema)({
      title: "hello",
      extra: "preserved",
    })

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success).toEqual({
        title: "hello",
        tasks: [],
        nested: {},
      })
    }
  })

  it("wraps single array values in structural mode", () => {
    const schema = coerceStructure(Schema.Array(Schema.Number))
    const result = Schema.decodeUnknownResult(schema)("5")

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success).toEqual([5])
    }
  })

  it("coerces numbers in structural mode", () => {
    const schema = coerceStructure(Schema.Number)

    const valid = Schema.decodeUnknownResult(schema)("6")
    const invalid = Schema.decodeUnknownResult(schema)("abc")
    const empty = Schema.decodeUnknownResult(schema)("")

    expect(Result.isSuccess(valid)).toBe(true)
    expect(Result.isSuccess(invalid)).toBe(true)
    expect(Result.isSuccess(empty)).toBe(true)

    if (Result.isSuccess(valid)) {
      expect(valid.success).toBe(6)
    }

    if (Result.isSuccess(invalid)) {
      expect(invalid.success).toBeNaN()
    }

    if (Result.isSuccess(empty)) {
      expect(empty.success).toBeNaN()
    }
  })

  it("coerces booleans in structural mode", () => {
    const schema = coerceStructure(Schema.Boolean)

    expect(Schema.decodeUnknownSync(schema)("on")).toBe(true)
    expect(Schema.decodeUnknownSync(schema)("")).toBe(false)
    expect(Schema.decodeUnknownSync(schema)("false")).toBe(false)
  })

  it("coerces dates in structural mode", () => {
    const schema = coerceStructure(Schema.Date)

    const valid = Schema.decodeUnknownSync(schema)("2026-01-01T12:00:00.000")
    const invalid = Schema.decodeUnknownSync(schema)("abc")
    const empty = Schema.decodeUnknownSync(schema)("")

    expect(valid).toEqual(new Date("2026-01-01T12:00:00.000Z"))
    expect(invalid).toBeInstanceOf(Date)
    expect(invalid.getTime()).toBeNaN()
    expect(empty).toBeInstanceOf(Date)
    expect(empty.getTime()).toBeNaN()
  })

  it("coerces bigint in structural mode", () => {
    const schema = coerceStructure(Schema.BigInt)

    expect(Schema.decodeUnknownSync(schema)("123")).toBe(123n)
    expect(Schema.decodeUnknownSync(schema)("abc")).toBe(0n)
    expect(Schema.decodeUnknownSync(schema)("")).toBe(0n)
  })

  it("supports literals in structural mode", () => {
    expect(
      Schema.decodeUnknownSync(coerceStructure(Schema.Literal("a")))("a"),
    ).toBe("a")
    expect(
      Schema.decodeUnknownSync(coerceStructure(Schema.Literal(0)))("0"),
    ).toBe(0)
    expect(
      Schema.decodeUnknownSync(coerceStructure(Schema.Literal(true)))("on"),
    ).toBe(true)
  })

  it("supports optional and nullable in structural mode", () => {
    expect(
      Schema.decodeUnknownSync(coerceStructure(Schema.optional(Schema.Number)))(
        "5",
      ),
    ).toBe(5)
    expect(
      Schema.decodeUnknownSync(coerceStructure(Schema.optional(Schema.Number)))(
        undefined,
      ),
    ).toBeUndefined()
    expect(
      Schema.decodeUnknownSync(coerceStructure(Schema.NullOr(Schema.Number)))(
        "5",
      ),
    ).toBe(5)
    expect(
      Schema.decodeUnknownSync(coerceStructure(Schema.NullOr(Schema.Number)))(
        null,
      ),
    ).toBeNull()
  })

  it("supports primitive unions in structural mode", () => {
    const schema = coerceStructure(Schema.Union([Schema.String, Schema.Number]))

    expect(Schema.decodeUnknownSync(schema)("")).toBe("")
    expect(Schema.decodeUnknownSync(schema)("hello")).toBe("hello")
    expect(Schema.decodeUnknownSync(schema)(42)).toBe(42)
  })

  it("supports discriminated object unions in structural mode", () => {
    const schema = coerceStructure(
      Schema.Union([
        Schema.Struct({
          type: Schema.Literal("number"),
          value: Schema.Number,
        }),
        Schema.Struct({
          type: Schema.Literal("string"),
          value: Schema.String,
        }),
      ]),
    )

    expect(
      Schema.decodeUnknownSync(schema)({ type: "number", value: "42" }),
    ).toEqual({
      type: "number",
      value: 42,
    })
    expect(
      Schema.decodeUnknownSync(schema)({ type: "string", value: "hello" }),
    ).toEqual({
      type: "string",
      value: "hello",
    })
  })

  it("supports custom stripEmptyString", () => {
    const schema = configureCoercion({
      stripEmptyString: (value) => {
        const trimmed = value.trim()
        return trimmed === "" ? undefined : trimmed
      },
    }).coerceFormValue(
      Schema.Struct({
        title: Schema.String,
        count: Schema.Number,
      }),
    )
    const result = Schema.decodeUnknownResult(schema)({
      title: " ",
      count: " ",
    })

    expect(Result.isFailure(result)).toBe(true)
  })

  it("supports custom type coercion", () => {
    const schema = configureCoercion({
      type: {
        number: (text) => Number(text.trim().replace(/,/g, "")),
        boolean: (text) => text === "true",
        date: (text) => new Date(`${text}Z`),
      },
    }).coerceFormValue(
      Schema.Struct({
        count: Schema.Number,
        confirmed: Schema.Boolean,
        createdAt: Schema.Date,
      }),
    )
    const result = Schema.decodeUnknownResult(schema)({
      count: " 123,456 ",
      confirmed: "true",
      createdAt: "2026-01-01T12:00:00.000",
    })

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success).toEqual({
        count: 123456,
        confirmed: true,
        createdAt: new Date("2026-01-01T12:00:00.000Z"),
      })
    }
  })
})
