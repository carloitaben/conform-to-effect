import type { ValidationAttributes, FormError } from "@conform-to/dom/future"
import {
  appendPath,
  formatIssues,
  formatPath,
  getRelativePath,
  parsePath,
  serializeHtmlPattern,
} from "@conform-to/dom/future"
import {
  Option,
  Result,
  Schema as EffectSchema,
  SchemaAST,
  SchemaGetter,
  SchemaIssue,
  SchemaParser,
} from "effect"

const formErrorMessage = {
  required: "form_error_required",
  invalidType: "form_error_invalid_type",
  invalid: "form_error_invalid",
} as const

const constraintKeys: Array<keyof ValidationAttributes> = [
  "required",
  "minLength",
  "maxLength",
  "min",
  "max",
  "step",
  "multiple",
  "pattern",
  "accept",
]

type FormatIssue = ReturnType<typeof formatSchemaIssue>["issues"][number]

type SchemaIssueFormatter = (issue: SchemaIssue.Issue) => {
  issues: ReadonlyArray<{
    message: string
    path?: ReadonlyArray<unknown>
  }>
}

type CoercionConfig = {
  stripEmptyString?: (value: string) => string | undefined
  type?: {
    number?: (text: string) => number
    boolean?: (text: string) => boolean
    date?: (text: string) => Date
  }
  customize?: (schema: EffectSchema.Top) => ((value: unknown) => unknown) | null
}

type CoercionMode = "validation" | "structure"

type CoercedFormSchema<Schema extends EffectSchema.Constraint> =
  EffectSchema.ConstraintDecoder<Schema["Type"], Schema["DecodingServices"]>

type CoercedStructureSchema<Schema extends EffectSchema.Constraint> =
  EffectSchema.ConstraintDecoder<Schema["Encoded"], Schema["DecodingServices"]>

type CoercionSettings = {
  stripEmptyString: (value: string) => string | undefined
  type: {
    number: (text: string) => number
    boolean: (text: string) => boolean
    date: (text: string) => Date
  }
  customize?: (schema: EffectSchema.Top) => ((value: unknown) => unknown) | null
}

function assignConstraintValue(
  constraint: ValidationAttributes,
  key: keyof ValidationAttributes,
  value: NonNullable<ValidationAttributes[keyof ValidationAttributes]>,
) {
  switch (key) {
    case "required":
    case "multiple":
      constraint[key] = value === true
      return
    case "minLength":
    case "maxLength":
      if (typeof value === "number") {
        constraint[key] = value
      }
      return
    case "min":
    case "max":
    case "step":
      if (typeof value === "string" || typeof value === "number") {
        constraint[key] = value
      }
      return
    case "pattern":
    case "accept":
      if (typeof value === "string") {
        constraint[key] = value
      }
      return
  }
}

function getConstraintEntry(
  constraints: Record<string, ValidationAttributes>,
  name: string,
) {
  return (constraints[name] ??= { required: true })
}

function applyFilterConstraint(
  constraint: ValidationAttributes,
  filter: SchemaAST.Filter<unknown> | SchemaAST.FilterGroup<unknown>,
) {
  const arbitrary = filter.annotations?.arbitrary?.constraint

  if (arbitrary?.minLength !== undefined) {
    constraint.minLength = arbitrary.minLength
  }

  if (arbitrary?.maxLength !== undefined) {
    constraint.maxLength = arbitrary.maxLength
  }

  if (arbitrary?.ordered?.minimum !== undefined) {
    constraint.min = arbitrary.ordered.minimum
  }

  if (arbitrary?.ordered?.maximum !== undefined) {
    constraint.max = arbitrary.ordered.maximum
  }

  if (arbitrary?.patterns) {
    const pattern = serializeHtmlPattern(
      arbitrary.patterns.map((source) => new RegExp(source)),
    )

    if (pattern) {
      constraint.pattern = pattern
    }
  }
}

function applyChecks(
  constraint: ValidationAttributes,
  checks: SchemaAST.Checks | undefined,
) {
  if (!checks) {
    return
  }

  for (const check of checks) {
    if (check._tag === "Filter") {
      applyFilterConstraint(constraint, check)
      continue
    }

    applyFilterConstraint(constraint, check)

    for (const nestedCheck of check.checks) {
      applyFilterConstraint(constraint, nestedCheck)
    }
  }
}

function getEnumPattern(ast: SchemaAST.Enum) {
  const values = ast.enums
    .map(([, value]) => value)
    .filter((value): value is string => typeof value === "string")

  if (values.length === 0) {
    return undefined
  }

  return values
    .map((value) =>
      value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&").replace(/-/g, "\\x2d"),
    )
    .join("|")
}

function mergeBranchConstraints(
  previous: Record<string, ValidationAttributes>,
  next: Record<string, ValidationAttributes>,
) {
  const names = new Set([...Object.keys(previous), ...Object.keys(next)])
  const merged: Record<string, ValidationAttributes> = {}

  for (const name of names) {
    if (name in previous && name in next) {
      const previousConstraint = previous[name]
      const nextConstraint = next[name]
      const constraint: ValidationAttributes = {}

      merged[name] = constraint

      for (const key of constraintKeys) {
        if (
          previousConstraint[key] !== undefined &&
          nextConstraint[key] !== undefined &&
          previousConstraint[key] === nextConstraint[key]
        ) {
          assignConstraintValue(constraint, key, previousConstraint[key])
        }
      }

      continue
    }

    merged[name] = {
      ...(name in previous ? previous[name] : undefined),
      ...(name in next ? next[name] : undefined),
      required: false,
    }
  }

  return merged
}

function getEffectConstraint(
  schema: EffectSchema.Top,
): Record<string, ValidationAttributes> | undefined {
  const processingPaths = new Map<SchemaAST.AST, string>()
  const aliases: Array<{
    from: Array<string | number>
    to: Array<string | number>
  }> = []
  const constraints: Record<string, ValidationAttributes> = {}
  const cache: Record<string, ValidationAttributes | undefined> = {}

  function updateConstraint(
    ast: SchemaAST.AST,
    data: Record<string, ValidationAttributes>,
    name = "",
  ): void {
    if (SchemaAST.isSuspend(ast)) {
      updateConstraint(ast.thunk(), data, name)
      return
    }

    const processingPath = processingPaths.get(ast)

    if (processingPath !== undefined) {
      aliases.push({
        from: parsePath(name),
        to: parsePath(processingPath),
      })
      return
    }

    processingPaths.set(ast, name)

    if (SchemaAST.isObjects(ast)) {
      for (const propertySignature of ast.propertySignatures) {
        if (
          typeof propertySignature.name !== "string" &&
          typeof propertySignature.name !== "number"
        ) {
          continue
        }

        const propertyName = appendPath(
          name || undefined,
          propertySignature.name,
        )

        if (SchemaAST.isOptional(propertySignature.type)) {
          getConstraintEntry(data, propertyName).required = false
        }

        updateConstraint(propertySignature.type, data, propertyName)
      }

      processingPaths.delete(ast)
      return
    }

    if (SchemaAST.isUnion(ast)) {
      const branchConstraints = ast.types.map((type) => {
        const branchResult: Record<string, ValidationAttributes> = {}
        updateConstraint(type, branchResult, name)
        return branchResult
      })

      if (branchConstraints.length > 0) {
        const [firstConstraint, ...restConstraints] = branchConstraints
        Object.assign(
          data,
          restConstraints.reduce(mergeBranchConstraints, firstConstraint),
        )
      }

      processingPaths.delete(ast)
      return
    }

    if (name === "") {
      processingPaths.delete(ast)
      return
    }

    const constraint = getConstraintEntry(data, name)
    applyChecks(constraint, ast.checks)

    if (SchemaAST.isArrays(ast)) {
      constraint.multiple = true

      ast.elements.forEach((element, index) => {
        updateConstraint(element, data, appendPath(name, index))
      })

      ast.rest.forEach((element) => {
        updateConstraint(element, data, appendPath(name, ""))
      })
    } else if (SchemaAST.isEnum(ast)) {
      constraint.pattern = getEnumPattern(ast)
    }

    processingPaths.delete(ast)
  }

  function resolve(
    nameOrSegments: string | Array<string | number>,
  ): ValidationAttributes | undefined {
    const name =
      typeof nameOrSegments === "string"
        ? nameOrSegments
        : formatPath(nameOrSegments)

    if (name in constraints) {
      return constraints[name]
    }

    const segments =
      typeof nameOrSegments === "string"
        ? parsePath(nameOrSegments)
        : nameOrSegments

    for (const alias of aliases) {
      const tail = getRelativePath(segments, alias.from)

      if (tail !== null && tail.length > 0) {
        return resolve([...alias.to, ...tail])
      }
    }

    for (let index = segments.length - 1; index >= 0; index--) {
      if (typeof segments[index] === "number") {
        const normalizedSegments = [...segments]
        normalizedSegments[index] = ""
        return resolve(normalizedSegments)
      }
    }

    return undefined
  }

  updateConstraint(schema.ast, constraints)

  return new Proxy(constraints, {
    get(target, property, receiver) {
      if (typeof property !== "string") {
        return Reflect.get(target, property, receiver)
      }

      if (property in cache) {
        return cache[property]
      }

      const resolved = resolve(property)
      cache[property] = resolved
      return resolved
    },
  })
}

const formatSchemaIssue: SchemaIssueFormatter =
  SchemaIssue.makeFormatterStandardSchemaV1({
    leafHook: (issue) => {
      switch (issue._tag) {
        case "InvalidType":
          return formErrorMessage.invalidType
        case "InvalidValue":
          if (Option.isSome(issue.actual) && issue.actual.value === "") {
            return formErrorMessage.required
          }
          return SchemaIssue.defaultLeafHook(issue)
        case "MissingKey":
          return formErrorMessage.required
        default:
          return SchemaIssue.defaultLeafHook(issue)
      }
    },
    checkHook: (issue) => {
      if (issue.actual === "") {
        return formErrorMessage.required
      }

      const message = SchemaIssue.defaultCheckHook(issue)

      if (message) {
        return message
      }

      return formErrorMessage.invalid
    },
  })

function getIssuePath(issue: FormatIssue) {
  return (issue.path ?? []).reduce<string>((name, segment) => {
    if (typeof segment !== "string" && typeof segment !== "number") {
      throw new Error(
        `Only string or numeric path segments are supported. Received segment: ${String(segment)}`,
      )
    }

    return appendPath(name, segment)
  }, "")
}

function createFormError<ErrorShape = string[]>(
  issues: ReadonlyArray<FormatIssue>,
  formatFieldIssues?: (issues: Array<FormatIssue>, name: string) => ErrorShape,
): FormError<string[] | ErrorShape> | null {
  if (issues.length === 0) {
    return null
  }

  const issuesByName: Record<string, Array<FormatIssue>> = {}

  for (const issue of issues) {
    const name = getIssuePath(issue)
    issuesByName[name] ??= []
    issuesByName[name].push(issue)
  }

  const { "": formErrors = null, ...fieldErrors } = Object.entries(
    issuesByName,
  ).reduce<Record<string, string[] | ErrorShape>>(
    (result, [name, fieldIssues]) => {
      result[name] = formatFieldIssues
        ? formatFieldIssues(fieldIssues, name)
        : fieldIssues.map((issue) => issue.message)

      return result
    },
    {},
  )

  return {
    formErrors,
    fieldErrors,
  }
}

export function isSchema(schema: unknown): schema is EffectSchema.Top {
  return EffectSchema.isSchema(schema)
}

export function getConstraints(
  schema: unknown,
): Record<string, ValidationAttributes> | undefined {
  if (!isSchema(schema)) {
    return undefined
  }

  return getEffectConstraint(schema)
}

export function formatResult<
  Schema extends EffectSchema.ConstraintDecoder<unknown>,
>(
  result: Result.Result<Schema["Type"], EffectSchema.SchemaError>,
): FormError<string[]> | null
export function formatResult<
  Schema extends EffectSchema.ConstraintDecoder<unknown>,
  ErrorShape,
>(
  result: Result.Result<Schema["Type"], EffectSchema.SchemaError>,
  options: {
    includeValue: true
    formatIssues: (issues: Array<FormatIssue>, name: string) => ErrorShape
  },
): {
  error: FormError<ErrorShape> | null
  value: Schema["Type"] | undefined
}
export function formatResult<
  Schema extends EffectSchema.ConstraintDecoder<unknown>,
>(
  result: Result.Result<Schema["Type"], EffectSchema.SchemaError>,
  options: {
    includeValue: true
    formatIssues?: undefined
  },
): {
  error: FormError<string[]> | null
  value: Schema["Type"] | undefined
}
export function formatResult<
  Schema extends EffectSchema.ConstraintDecoder<unknown>,
  ErrorShape,
>(
  result: Result.Result<Schema["Type"], EffectSchema.SchemaError>,
  options: {
    includeValue?: false
    formatIssues: (issues: Array<FormatIssue>, name: string) => ErrorShape
  },
): FormError<ErrorShape> | null
export function formatResult<
  Schema extends EffectSchema.ConstraintDecoder<unknown>,
  ErrorShape = string[],
>(
  result: Result.Result<Schema["Type"], EffectSchema.SchemaError>,
  options?: {
    includeValue?: boolean
    formatIssues?: (issues: Array<FormatIssue>, name: string) => ErrorShape
  },
):
  | FormError<string[] | ErrorShape>
  | {
      error: FormError<string[] | ErrorShape> | null
      value: Schema["Type"] | undefined
    }
  | null {
  const error = Result.isFailure(result)
    ? createFormError(
        formatSchemaIssue(result.failure.issue).issues,
        options?.formatIssues,
      )
    : null

  if (options?.includeValue) {
    return {
      error,
      value: Result.isSuccess(result) ? result.success : undefined,
    }
  }

  return error
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
    typeof ast.annotations?.typeConstructor === "object" &&
    ast.annotations.typeConstructor !== null &&
    "_tag" in ast.annotations.typeConstructor &&
    ast.annotations.typeConstructor._tag === "Date"
  )
}

function isStringLikeAst(ast: SchemaAST.AST): boolean {
  return (
    SchemaAST.isString(ast) ||
    (SchemaAST.isLiteral(ast) && typeof ast.literal === "string")
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
    return undefined
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
    return BigInt(normalized)
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

  if (ast.rest.length === 0) {
    return undefined
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

  if (literalFields.length === 0) {
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

function createCoercionSchema<Schema extends EffectSchema.Top>(
  schema: Schema,
  preprocess: (value: unknown) => unknown,
): CoercedFormSchema<Schema> {
  return EffectSchema.Unknown.pipe(
    EffectSchema.decodeTo(schema, {
      decode: SchemaGetter.transformOrFail((value, options) => {
        return SchemaParser.decodeUnknownEffect(schema)(
          preprocess(value),
          options,
        )
      }),
      encode: SchemaGetter.transform((value) => value),
    }),
  )
}

function createStructuralSchema<Schema extends EffectSchema.Top>(
  schema: Schema,
  preprocess: (value: unknown) => unknown,
): CoercedStructureSchema<Schema> {
  const encodedSchema = EffectSchema.toEncoded(schema)

  return EffectSchema.Unknown.pipe(
    EffectSchema.decodeTo(encodedSchema, {
      decode: SchemaGetter.transformOrFail((value, options) => {
        return SchemaParser.decodeUnknownEffect(encodedSchema)(
          preprocess(value),
          {
            ...options,
            disableChecks: true,
            onExcessProperty: "preserve",
          },
        )
      }),
      encode: SchemaGetter.transform((value) => value),
    }),
  )
}

export function configureCoercion(config?: CoercionConfig): {
  coerceFormValue<Schema extends EffectSchema.Top>(
    schema: Schema,
  ): CoercedFormSchema<Schema>
  coerceStructure<Schema extends EffectSchema.Top>(
    schema: Schema,
  ): CoercedStructureSchema<Schema>
} {
  const settings: CoercionSettings = {
    stripEmptyString:
      config?.stripEmptyString ??
      ((value) => (value === "" ? undefined : value)),
    type: {
      number: config?.type?.number ?? Number,
      boolean: config?.type?.boolean ?? ((text) => text === "on"),
      date: config?.type?.date ?? defaultDate,
    },
    customize: config?.customize,
  }
  return {
    coerceFormValue(schema) {
      const encodedAst = SchemaAST.toEncoded(schema.ast)
      return createCoercionSchema(schema, (value) => {
        const customized = settings.customize?.(schema)

        if (customized) {
          return customized(value)
        }

        return coerceValue(encodedAst, value, "validation", settings)
      })
    },
    coerceStructure(schema) {
      const encodedAst = SchemaAST.toEncoded(schema.ast)
      return createStructuralSchema(schema, (value) => {
        const customized = settings.customize?.(schema)

        if (customized) {
          return customized(value)
        }

        return coerceValue(encodedAst, value, "structure", settings)
      })
    },
  }
}

const defaultCoercion = configureCoercion()

export const coerceFormValue = defaultCoercion.coerceFormValue

export const coerceStructure = defaultCoercion.coerceStructure

export { formatIssues }
