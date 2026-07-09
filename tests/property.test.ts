import fc from "fast-check"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { coerceFormValue, coerceStructure } from "../src/index.js"

describe("property tests", () => {
  it("coerceStructure(number) always succeeds with a number for string input", () => {
    const schema = coerceStructure(Schema.Number)

    fc.assert(
      fc.property(fc.string(), (value) => {
        const result = Schema.decodeUnknownSync(schema)(value)

        expect(typeof result).toBe("number")
      }),
    )
  })

  it("coerceStructure(bigint) always succeeds with a bigint for string input", () => {
    const schema = coerceStructure(Schema.BigInt)

    fc.assert(
      fc.property(fc.string(), (value) => {
        const result = Schema.decodeUnknownSync(schema)(value)

        expect(typeof result).toBe("bigint")
      }),
    )
  })

  it("coerceFormValue preserves already-typed valid values", () => {
    const schema = coerceFormValue(
      Schema.Struct({
        count: Schema.Number,
        confirmed: Schema.Boolean,
        amount: Schema.BigInt,
      }),
    )

    fc.assert(
      fc.property(
        fc.record({
          count: fc.double({ noNaN: true }),
          confirmed: fc.boolean(),
          amount: fc.bigInt(),
        }),
        (value) => {
          expect(Schema.decodeUnknownSync(schema)(value)).toEqual(value)
        },
      ),
    )
  })
})
