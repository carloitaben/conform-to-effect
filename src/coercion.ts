import { Schema, SchemaAST, SchemaGetter, SchemaParser } from "effect"
import { isStringLikeAst } from "./ast.js"

type CoercionConfig = {
  /**
   * Validation only: determines what string values are "empty" → undefined.
   * Receives a raw string and returns the string (possibly transformed) or
   * `undefined` to indicate empty. Empty files are always stripped at the
   * system level.
   *
   * @default (value) => value === '' ? undefined : value
   */
  stripEmptyString?: (value: string) => string | undefined
  /**
   * Type-specific string → typed value conversion functions.
   * Shared between validation and structural modes. The system handles
   * non-string passthrough and per-mode empty handling.
   *
   * Defaults: number via `Number()`, boolean checks `'on'`, date via
   * `new Date()`, bigint via `BigInt()`.
   */
  type?: {
    number?: (text: string) => number
    boolean?: (text: string) => boolean
    date?: (text: string) => Date
    bigint?: (text: string) => bigint
  }
  /**
   * Per-schema escape hatch. Return a coercion function to override
   * the default for a specific schema, or `null` to use the default.
   * The coercion function receives the raw form value (string, File,
   * array, etc.) and neither `stripEmptyString` nor `coerceString`
   * is applied automatically.
   */
  customize?: (schema: Schema.Top) => ((value: unknown) => unknown) | null
}

type CoercionMode = "validation" | "structure"

type CoercedFormSchema<S extends Schema.Constraint> = Schema.Codec<
  S["Type"],
  unknown,
  S["DecodingServices"],
  S["EncodingServices"]
>

type CoercedStructureSchema<S extends Schema.Constraint> = Schema.Codec<
  S["Encoded"],
  unknown,
  S["DecodingServices"],
  S["EncodingServices"]
>

type CoercionSettings = {
  stripEmptyString: (value: string) => string | undefined
  type: {
    number: (text: string) => number
    boolean: (text: string) => boolean
    date: (text: string) => Date
    bigint: (text: string) => bigint
  }
  customize?: (schema: Schema.Top) => ((value: unknown) => unknown) | null
}

function defaultDate(text: string): Date {
  const date = new Date(shouldAppendUtcSuffix(text) ? `${text}Z` : text)

  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date")
  }

  return date
}

function shouldAppendUtcSuffix(datetimeString: string): boolean {
  if (datetimeString.includes(" ")) {
    return false
  }

  const separatorIndex = datetimeString.indexOf("T")

  if (separatorIndex < 0) {
    return false
  }

  const time = datetimeString.slice(separatorIndex + 1)

  return !(
    time.toUpperCase().endsWith("Z") ||
    time.includes("+") ||
    time.includes("-")
  )
}

function isPlainObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isDateAst(ast: SchemaAST.AST): boolean {
  return (
    ast._tag === "Declaration" &&
    typeof ast.annotations?.representation === "object" &&
    ast.annotations.representation !== null &&
    "id" in ast.annotations.representation &&
    ast.annotations.representation.id === "effect/schema/Date"
  )
}

function isCoercibleFromStringAst(ast: SchemaAST.AST): boolean {
  return (
    SchemaAST.isNumber(ast) ||
    SchemaAST.isBoolean(ast) ||
    SchemaAST.isBigInt(ast) ||
    isDateAst(ast) ||
    (SchemaAST.isLiteral(ast) &&
      (typeof ast.literal === "number" || typeof ast.literal === "boolean"))
  )
}

function normalizeString(
  value: string,
  mode: CoercionMode,
  settings: CoercionSettings,
): string | undefined {
  return mode === "validation" ? settings.stripEmptyString(value) : value
}

function coerceNumberString(
  value: string,
  mode: CoercionMode,
  settings: CoercionSettings,
): number | string | undefined {
  const normalized = normalizeString(value, mode, settings)

  if (normalized === undefined) {
    return
  }

  if (mode === "structure" && normalized.trim() === "") {
    return Number.NaN
  }

  const converted = settings.type.number(normalized)

  if (Number.isNaN(converted)) {
    return mode === "structure" ? Number.NaN : value
  }

  return converted
}

function coerceBooleanString(
  value: string,
  mode: CoercionMode,
  settings: CoercionSettings,
): boolean | undefined {
  const normalized = normalizeString(value, mode, settings)

  if (normalized === undefined) {
    return mode === "structure" ? false : undefined
  }

  return settings.type.boolean(normalized)
}

function coerceDateString(
  value: string,
  mode: CoercionMode,
  settings: CoercionSettings,
): Date | string | undefined {
  const normalized = normalizeString(value, mode, settings)

  if (normalized === undefined) {
    return mode === "structure" ? new Date("") : undefined
  }

  try {
    return settings.type.date(normalized)
  } catch {
    return mode === "structure" ? new Date("") : value
  }
}

function coerceBigIntString(
  value: string,
  mode: CoercionMode,
  settings: CoercionSettings,
): bigint | string | undefined {
  const normalized = normalizeString(value, mode, settings)

  if (normalized === undefined) {
    return mode === "structure" ? 0n : undefined
  }

  try {
    return settings.type.bigint(normalized)
  } catch {
    return mode === "structure" ? 0n : value
  }
}

function coercePrimitive(
  ast: SchemaAST.AST,
  value: unknown,
  mode: CoercionMode,
  settings: CoercionSettings,
): unknown {
  if (typeof value !== "string") {
    return value
  }

  if (SchemaAST.isString(ast)) {
    return normalizeString(value, mode, settings)
  }

  if (SchemaAST.isNumber(ast)) {
    return coerceNumberString(value, mode, settings)
  }

  if (SchemaAST.isBoolean(ast)) {
    return coerceBooleanString(value, mode, settings)
  }

  if (SchemaAST.isBigInt(ast)) {
    return coerceBigIntString(value, mode, settings)
  }

  if (isDateAst(ast)) {
    return coerceDateString(value, mode, settings)
  }

  if (SchemaAST.isLiteral(ast)) {
    switch (typeof ast.literal) {
      case "string":
        return value
      case "number":
        return coerceNumberString(value, mode, settings)
      case "boolean":
        return coerceBooleanString(value, mode, settings)
      case "bigint":
        return coerceBigIntString(value, mode, settings)
    }
  }

  return value
}

function selectArrayElementAst(
  ast: SchemaAST.Arrays,
  index: number,
): SchemaAST.AST | undefined {
  if (index < ast.elements.length) {
    return ast.elements[index]
  }

  if (!ast.rest.length) {
    return
  }

  if (ast.rest.length === 1) {
    return ast.rest[0]
  }

  const tailStart = Math.max(ast.elements.length, index - ast.rest.length + 1)

  if (index >= tailStart) {
    return ast.rest[index - tailStart]
  }

  return ast.rest[0]
}

function getLiteralFields(ast: SchemaAST.Objects) {
  return ast.propertySignatures.filter((propertySignature) =>
    SchemaAST.isLiteral(propertySignature.type),
  )
}

function matchesLiteralFields(
  ast: SchemaAST.Objects,
  value: Record<PropertyKey, unknown>,
  mode: CoercionMode,
  settings: CoercionSettings,
): boolean {
  const literalFields = getLiteralFields(ast)

  if (!literalFields.length) {
    return false
  }

  return literalFields.every((propertySignature) => {
    const actual = coercePrimitive(
      propertySignature.type,
      value[propertySignature.name],
      mode,
      settings,
    )
    return (
      SchemaAST.isLiteral(propertySignature.type) &&
      actual === propertySignature.type.literal
    )
  })
}

function selectUnionBranch(
  ast: SchemaAST.Union,
  value: unknown,
  mode: CoercionMode,
  settings: CoercionSettings,
): SchemaAST.AST {
  if (value === undefined) {
    return ast.types.find(SchemaAST.isUndefined) ?? ast.types[0]
  }

  if (value === null) {
    return ast.types.find(SchemaAST.isNull) ?? ast.types[0]
  }

  if (isPlainObject(value)) {
    const matched = ast.types.find(
      (type) =>
        SchemaAST.isObjects(type) &&
        matchesLiteralFields(type, value, mode, settings),
    )

    if (matched) {
      return matched
    }
  }

  if (typeof value === "string") {
    const stringLike = ast.types.find(isStringLikeAst)

    if (stringLike) {
      return stringLike
    }

    const coercible = ast.types.find(isCoercibleFromStringAst)

    if (coercible) {
      return coercible
    }
  }

  return ast.types[0]
}

function coerceValue(
  ast: SchemaAST.AST,
  value: unknown,
  mode: CoercionMode,
  settings: CoercionSettings,
): unknown {
  if (SchemaAST.isSuspend(ast)) {
    return coerceValue(ast.thunk(), value, mode, settings)
  }

  const customCoercion = settings.customize?.(Schema.make(ast))

  if (customCoercion) {
    return customCoercion(value)
  }

  const primitive = coercePrimitive(ast, value, mode, settings)

  if (primitive !== value) {
    return primitive
  }

  if (SchemaAST.isUnion(ast)) {
    return coerceValue(
      selectUnionBranch(ast, value, mode, settings),
      value,
      mode,
      settings,
    )
  }

  if (SchemaAST.isArrays(ast)) {
    if (value === undefined && mode === "structure") {
      return []
    }

    const items = Array.isArray(value)
      ? value
      : value === undefined
        ? []
        : [value]

    return items.map((item, index) => {
      const elementAst = selectArrayElementAst(ast, index)
      return elementAst ? coerceValue(elementAst, item, mode, settings) : item
    })
  }

  if (SchemaAST.isObjects(ast)) {
    if (value === undefined && mode === "structure") {
      value = {}
    }

    if (!isPlainObject(value)) {
      return value
    }

    const output: Record<PropertyKey, unknown> = { ...value }

    for (const propertySignature of ast.propertySignatures) {
      const propertyValue = coerceValue(
        propertySignature.type,
        value[propertySignature.name],
        mode,
        settings,
      )

      if (
        propertyValue !== undefined ||
        Object.hasOwn(value, propertySignature.name)
      ) {
        output[propertySignature.name] = propertyValue
      }
    }

    return output
  }

  return value
}

function createLeafCoercionAst(
  ast: SchemaAST.AST,
  settings: CoercionSettings,
): SchemaAST.AST {
  if (ast.encoding) {
    return ast
  }

  const target = Schema.make<Schema.Codec<any, any>>(ast)

  const customCoercion = settings.customize?.(target)

  if (customCoercion) {
    return Schema.Unknown.pipe(
      Schema.decodeTo(target, {
        decode: SchemaGetter.transform(customCoercion),
        encode: SchemaGetter.transform((value) => value),
      }),
    ).ast
  }

  return Schema.Unknown.pipe(
    Schema.decodeTo(target, {
      decode: SchemaGetter.transform((value) =>
        SchemaAST.isUndefined(ast) && typeof value === "string"
          ? normalizeString(value, "validation", settings)
          : coercePrimitive(ast, value, "validation", settings),
      ),
      encode: SchemaGetter.transform((value) => value),
    }),
  ).ast
}

function unwrapSuspend(ast: SchemaAST.AST): SchemaAST.AST {
  if (SchemaAST.isSuspend(ast)) {
    return unwrapSuspend(ast.thunk())
  }
  return ast
}

function isDirectCompound(ast: SchemaAST.AST): boolean {
  const resolved = unwrapSuspend(ast)
  return resolved._tag === "Objects" || resolved._tag === "Arrays"
}

function collectCompoundPrefills(ast: SchemaAST.AST): unknown {
  if (SchemaAST.isSuspend(ast)) {
    return collectCompoundPrefills(ast.thunk())
  }

  if (SchemaAST.isObjects(ast)) {
    const defaults: Record<string, unknown> = {}

    for (const ps of ast.propertySignatures) {
      if (
        typeof ps.name !== "string" &&
        typeof ps.name !== "number"
      ) {
        continue
      }

      if (
        !isDirectCompound(ps.type) ||
        SchemaAST.isOptional(ps.type)
      ) {
        continue
      }

      const inner = collectCompoundPrefills(ps.type)
      const resolved = unwrapSuspend(ps.type)
      defaults[String(ps.name)] = inner ?? (resolved._tag === "Arrays" ? [] : {})
    }

    if (Object.keys(defaults).length > 0) {
      return defaults
    }
  }

  return undefined
}

function mergeDefaults(
  target: Record<string, unknown>,
  defaults: unknown,
): void {
  if (!isPlainObject(defaults)) {
    return
  }

  for (const [key, value] of Object.entries(
    defaults as Record<string, unknown>,
  )) {
    if (!(key in target)) {
      target[key] = value
    } else if (isPlainObject(value) && isPlainObject(target[key])) {
      mergeDefaults(target[key] as Record<string, unknown>, value)
    }
  }
}

function prefillCompoundKeys(
  value: unknown,
  defaults: unknown,
): unknown {
  if (!isPlainObject(value)) {
    return value
  }

  const output = { ...value }
  mergeDefaults(output, defaults)

  return output
}

function createCoercionAst(
  ast: SchemaAST.AST,
  settings: CoercionSettings,
): SchemaAST.AST {
  const cache = new WeakMap<SchemaAST.AST, SchemaAST.AST>()

  function rewrite(current: SchemaAST.AST): SchemaAST.AST {
    const cached = cache.get(current)

    if (cached) {
      return cached
    }

    if (SchemaAST.isSuspend(current)) {
      const rewritten = new SchemaAST.Suspend(
        () => rewrite(current.thunk()),
        current.annotations,
        undefined,
        current.encoding,
        current.context,
      )
      cache.set(current, rewritten)
      return rewritten
    }

    if (current.encoding) {
      return current
    }

    if (SchemaAST.isUnion(current)) {
      const rewritten = new SchemaAST.Union(
        current.types.map(rewrite),
        current.mode,
        current.annotations,
        current.checks,
        current.encoding,
        current.context,
        current.encodingChecks,
      )
      cache.set(current, rewritten)
      return rewritten
    }

    if (SchemaAST.isArrays(current)) {
      const rewritten = new SchemaAST.Arrays(
        current.isMutable,
        current.elements.map(rewrite),
        current.rest.map(rewrite),
        current.annotations,
        current.checks,
        current.encoding,
        current.context,
        current.encodingChecks,
      )
      cache.set(current, rewritten)
      return rewritten
    }

    if (SchemaAST.isObjects(current)) {
      const rewritten = new SchemaAST.Objects(
        current.propertySignatures.map(
          (propertySignature) =>
            new SchemaAST.PropertySignature(
              propertySignature.name,
              rewrite(propertySignature.type),
            ),
        ),
        current.indexSignatures.map(
          (indexSignature) =>
            new SchemaAST.IndexSignature(
              indexSignature.parameter,
              rewrite(indexSignature.type),
              indexSignature.merge,
            ),
        ),
        current.annotations,
        current.checks,
        current.encoding,
        current.context,
        current.encodingChecks,
      )
      cache.set(current, rewritten)
      return rewritten
    }

    const rewritten = createLeafCoercionAst(current, settings)
    cache.set(current, rewritten)
    return rewritten
  }

  return rewrite(ast)
}

function createCoercionSchema<S extends Schema.Top>(
  schema: S,
  settings: CoercionSettings,
): CoercedFormSchema<S> {
  const rewritten = Schema.make<Schema.Codec<any, any>>(
    createCoercionAst(schema.ast, settings),
  )

  const defaults = collectCompoundPrefills(schema.ast)

  if (defaults === undefined) {
    return rewritten as CoercedFormSchema<S>
  }

  return Schema.Unknown.pipe(
    Schema.decodeTo(Schema.Unknown, {
      decode: SchemaGetter.transformOrFail((value, options) =>
        SchemaParser.decodeUnknownEffect(rewritten)(
          prefillCompoundKeys(value, defaults),
          options,
        ),
      ),
      encode: SchemaGetter.transform((value) => value),
    }),
  ) as CoercedFormSchema<S>
}

function createStructuralSchema<S extends Schema.Top>(
  schema: S,
  preprocess: (value: unknown) => unknown,
): CoercedStructureSchema<S> {
  return Schema.Unknown.pipe(
    Schema.decodeTo(Schema.Unknown, {
      decode: SchemaGetter.transformOrFail((value, options) => {
        return SchemaParser.decodeUnknownEffect(Schema.Unknown)(
          preprocess(value),
          { ...options, disableChecks: true, onExcessProperty: "preserve" },
        )
      }),
      encode: SchemaGetter.transform((value) => value),
    }),
  ) as CoercedStructureSchema<S>
}

/**
 * Creates configured coercion functions for form value parsing.
 *
 * **Example:**
 *
 * ```tsx
 * import { configureCoercion } from 'conform-to-effect';
 * import * as Schema from "effect/Schema";
 *
 * const { coerceFormValue, coerceStructure } = configureCoercion({
 *   // Trim whitespace and treat whitespace-only as empty
 *   stripEmptyString: (value) => {
 *     const trimmed = value.trim();
 *     return trimmed === '' ? undefined : trimmed;
 *   },
 *   type: {
 *     // Custom number parsing: strip commas
 *     number: (text) => Number(text.replace(/,/g, '')),
 *   },
 * });
 *
 * const schema = Schema.Struct({ age: Schema.Number, name: Schema.String });
 * const validationSchema = coerceFormValue(schema);
 * const structuralSchema = coerceStructure(schema);
 * ```
 */
export function configureCoercion(config?: CoercionConfig): {
  /**
   * Enhances a schema to coerce form values and strip empty values before validation.
   * This configured helper uses the options passed to `configureCoercion`.
   *
   * Results are cached per schema, so this can be called inline.
   *
   * **Example:**
   *
   * ```tsx
   * const schema = coerceFormValue(Schema.Struct({
   *   age: Schema.optional(Schema.Number),
   *   subscribe: Schema.Boolean,
   * }));
   *
   * v.parse(schema, { age: '', subscribe: 'on' });
   * // { age: undefined, subscribe: true }
   * ```
   */
  coerceFormValue<S extends Schema.Top>(schema: S): CoercedFormSchema<S>
  /**
   * Enhances a schema to coerce form values without running validation.
   * This configured helper is useful for reading current form values as typed data.
   *
   * It skips validation, defaults, transforms, and refinements, and does not strip
   * empty strings to `undefined`.
   *
   * For number, boolean, date, and bigint schemas, empty strings and other failed
   * string coercions still become fallback values:
   *
   * - `Schema.Number` -> `NaN`
   * - `Schema.Boolean` -> `false`
   * - `Schema.Date` -> `Invalid Date`
   * - `Schema.Bigint` -> `0n`
   *
   * Results are cached per schema, so this can be called inline.
   *
   * **Example:**
   *
   * ```tsx
   * const schema = coerceStructure(Schema.Struct({
   *   age: Schema.Number.pipe(Schema.greaterThanOrEqualTo(10)),
   * }));
   *
   * Schema.decodeUnknownSync(schema)({ age: '3' });
   * // { age: 3 }
   * ```
   */
  coerceStructure<S extends Schema.Top>(schema: S): CoercedStructureSchema<S>
} {
  const settings: CoercionSettings = {
    stripEmptyString:
      config?.stripEmptyString ??
      ((value) => (value === "" ? undefined : value)),
    type: {
      number: config?.type?.number ?? Number,
      boolean: config?.type?.boolean ?? ((text) => text === "on"),
      date: config?.type?.date ?? defaultDate,
      bigint: config?.type?.bigint ?? BigInt,
    },
    customize: config?.customize,
  }
  const formCache = new WeakMap<Schema.Top, CoercedFormSchema<any>>()
  const structureCache = new WeakMap<Schema.Top, CoercedStructureSchema<any>>()

  return {
    coerceFormValue(schema) {
      const cached = formCache.get(schema)
      if (cached) {
        return cached
      }

      const result = createCoercionSchema(schema, settings)

      formCache.set(schema, result)
      return result
    },
    coerceStructure(schema) {
      const cached = structureCache.get(schema)
      if (cached) {
        return cached
      }

      const encodedAst = SchemaAST.toEncoded(schema.ast)
      const result = createStructuralSchema(schema, (value) =>
        coerceValue(encodedAst, value, "structure", settings),
      )
      structureCache.set(schema, result)
      return result
    },
  }
}

export const { coerceFormValue, coerceStructure } = configureCoercion()
