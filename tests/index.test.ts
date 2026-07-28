import { Result, Schema, SchemaAST } from "effect"
import { Effect, Exit } from "effect"
import { describe, expect, it } from "vitest"
import {
  coerceFormValue,
  coerceStructure,
  configureCoercion,
} from "../src/coercion.js"
import {
  formatResult,
  formatExit,
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
        age: ['Expected number, got "12"'],
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
        extra: "preserved",
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

  it("coerces every object union branch before validation", () => {
    const schema = coerceFormValue(
      Schema.Union([
        Schema.Struct({ a: Schema.String }),
        Schema.Struct({ b: Schema.Number }),
      ]),
    )

    const result = Schema.decodeUnknownResult(schema, { errors: "all" })({
      b: "42",
    })

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success).toEqual({ b: 42 })
    }
  })

  it("coerces nested object union branches independent of declaration order", () => {
    const schema = coerceFormValue(
      Schema.Struct({
        f: Schema.Union([
          Schema.Struct({ a: Schema.String }),
          Schema.Struct({ b: Schema.Number }),
        ]),
      }),
    )

    const result = Schema.decodeUnknownResult(schema, { errors: "all" })({
      f: { b: "42" },
    })

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success).toEqual({ f: { b: 42 } })
    }
  })

  it("preserves existing codecs wrapped by form coercion", () => {
    const schema = coerceFormValue(
      Schema.Struct({ n: Schema.NumberFromString }),
    )
    const result = Schema.decodeUnknownResult(schema)({ n: "42" })

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success).toEqual({ n: 42 })
    }
  })

  it("preserves object-level checks while rewriting", () => {
    const schema = coerceFormValue(
      Schema.Struct({ a: Schema.String, b: Schema.String }).check(
        Schema.makeFilter((value) => value.a === value.b),
      ),
    )
    const result = Schema.decodeUnknownResult(schema)({ a: "x", b: "y" })

    expect(Result.isFailure(result)).toBe(true)
  })

  it("coerces record values", () => {
    const schema = coerceFormValue(Schema.Record(Schema.String, Schema.Number))
    const result = Schema.decodeUnknownResult(schema)({ a: "1", b: "2" })

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success).toEqual({ a: 1, b: 2 })
    }
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

  it("supports custom bigint coercion", () => {
    const schema = configureCoercion({
      type: {
        bigint: (text) => BigInt(text.trim()),
      },
    }).coerceFormValue(
      Schema.Struct({
        id: Schema.BigInt,
      }),
    )
    const result = Schema.decodeUnknownResult(schema)({ id: " 123 " })

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success).toEqual({ id: 123n })
    }
  })

  it("consults customize at each leaf node during form coercion", () => {
    const schema = configureCoercion({
      customize: (s) => {
        if (SchemaAST.isBigInt(s.ast)) {
          return (value) => {
            if (typeof value === "string") {
              const trimmed = value.trim()
              if (trimmed === "") return undefined
              return BigInt(trimmed)
            }
            return value
          }
        }
        return null
      },
    }).coerceFormValue(
      Schema.Struct({
        id: Schema.BigInt,
        name: Schema.String,
      }),
    )
    const result = Schema.decodeUnknownResult(schema)({
      id: " 42 ",
      name: "Alice",
    })

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success).toEqual({ id: 42n, name: "Alice" })
    }
  })

  it("consults customize at each node during structure coercion", () => {
    const schema = configureCoercion({
      type: {
        bigint: (text) => BigInt(text.trim()),
      },
      customize: (s) => {
        if (SchemaAST.isBigInt(s.ast)) {
          return (value) => {
            if (typeof value === "string") {
              return BigInt(value.trim() || "0")
            }
            return value
          }
        }
        return null
      },
    }).coerceStructure(
      Schema.Struct({
        id: Schema.BigInt,
      }),
    )
    const result = Schema.decodeUnknownSync(schema)({ id: " 99 " })

    expect(result).toEqual({ id: 99n })
  })

  it("reports optional fields as not required with their constraints intact", () => {
    const schema = Schema.Struct({
      opt: Schema.optional(Schema.String.check(Schema.isMinLength(3))),
      optKey: Schema.optionalKey(Schema.String.check(Schema.isMinLength(3))),
      nullable: Schema.NullOr(Schema.String.check(Schema.isMinLength(3))),
    })

    const c = getConstraints(schema)!

    expect(c["opt"]).toEqual({ required: false, minLength: 3 })
    expect(c["optKey"]).toEqual({ required: false, minLength: 3 })
    expect(c["nullable"]).toEqual({ required: true, minLength: 3 })
  })

  it("prefills required nested structs and arrays when keys are missing", () => {
    const schema = coerceFormValue(
      Schema.Struct({
        tags: Schema.Array(Schema.String),
        profile: Schema.Struct({
          bio: Schema.optional(Schema.String),
        }),
      }),
    )
    const result = Schema.decodeUnknownResult(schema)({})

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success).toEqual({
        tags: [],
        profile: { bio: undefined },
      })
    }
  })

  it("does not prefill optional compound types", () => {
    const schema = coerceFormValue(
      Schema.Struct({
        opt: Schema.optional(Schema.Struct({ x: Schema.Number })),
      }),
    )
    const result = Schema.decodeUnknownResult(schema)({})

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success).toEqual({ opt: undefined })
    }
  })

  it("prefills nested struct coercing inner fields too", () => {
    const schema = coerceFormValue(
      Schema.Struct({
        address: Schema.Struct({
          number: Schema.Number,
          city: Schema.String,
        }),
      }),
    )
    const result = Schema.decodeUnknownResult(schema)({
      address: { number: "42", city: "Paris" },
    })

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success).toEqual({
        address: { number: 42, city: "Paris" },
      })
    }
  })

  it("prefills deeply nested required structs", () => {
    const schema = coerceFormValue(
      Schema.Struct({
        outer: Schema.Struct({
          inner: Schema.Struct({
            leaf: Schema.optional(Schema.String),
          }),
        }),
      }),
    )
    const result = Schema.decodeUnknownResult(schema)({})

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success).toEqual({
        outer: { inner: { leaf: undefined } },
      })
    }
  })

  it("emits pattern for string literal unions", () => {
    const schema = Schema.Struct({
      status: Schema.Literals(["draft", "published", "archived"]),
    })
    const c = getConstraints(schema)!

    expect(c["status"]?.pattern).toBe("draft|published|archived")
  })

  it("emits pattern for Schema.Enum", () => {
    enum Kind {
      A = "a",
      B = "b",
    }
    const schema = Schema.Struct({
      kind: Schema.Enum(Kind),
    })
    const c = getConstraints(schema)!

    expect(c["kind"]?.pattern).toBe("a|b")
  })

  it("extracts constraints from Schema.Class", () => {
    class User extends Schema.Class<User>("User")({
      name: Schema.String.check(Schema.isMinLength(3)),
      age: Schema.optional(Schema.Number),
    }) {}

    const c = getConstraints(User)!

    expect(c["name"]?.required).toBe(true)
    expect(c["name"]?.minLength).toBe(3)
    expect(c["age"]?.required).toBe(false)
  })

  it("does not emit pattern for mixed literal unions", () => {
    const schema = Schema.Struct({
      mixed: Schema.Literals(["a", 1, true] as const),
    })
    const c = getConstraints(schema)!

    expect(c["mixed"]?.pattern).toBeUndefined()
  })

  it("formats Effect exits into conform form errors", async () => {
    const schema = Schema.Struct({ age: Schema.Number })

    {
      const exit = await Effect.runPromiseExit(
        Schema.decodeUnknownEffect(schema)({ age: "12" }),
      )

      expect(Exit.isFailure(exit)).toBe(true)

      if (Exit.isFailure(exit)) {
        expect(formatExit(exit)).toEqual({
          formErrors: null,
          fieldErrors: {
            age: ['Expected number, got "12"'],
          },
        })
      }
    }

    {
      const exit = await Effect.runPromiseExit(
        Schema.decodeUnknownEffect(schema)({ age: 42 }),
      )

      expect(Exit.isSuccess(exit)).toBe(true)

      if (Exit.isSuccess(exit)) {
        expect(formatExit(exit, { includeValue: true })).toEqual({
          error: null,
          value: { age: 42 },
        })
      }
    }
  })

  it("caches coerced schemas per schema identity", () => {
    const schema = Schema.Struct({ a: Schema.String })
    const a = coerceFormValue(schema)
    const b = coerceFormValue(schema)
    const c = coerceStructure(schema)
    const d = coerceStructure(schema)

    expect(a).toBe(b)
    expect(c).toBe(d)
  })
})
