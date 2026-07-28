import type { ValidationAttributes } from "@conform-to/dom/future"
import {
  appendPath,
  formatPath,
  getRelativePath,
  parsePath,
  serializeHtmlPattern,
} from "@conform-to/dom/future"
import { Schema, SchemaAST } from "effect"
import { isStringLikeAst } from "./ast.js"

declare module "effect/Schema" {
  namespace Annotations {
    interface Annotations {
      readonly accept?: string | undefined
    }
  }
}

function isFileAst(ast: SchemaAST.AST): boolean {
  return (
    ast._tag === "Declaration" &&
    typeof ast.annotations?.representation === "object" &&
    ast.annotations.representation !== null &&
    "id" in ast.annotations.representation &&
    ast.annotations.representation.id === "effect/schema/File"
  )
}

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

type NodeBounds = {
  minLength?: number
  maxLength?: number
  patterns: Array<RegExp>
  min?: string | number
  max?: string | number
  exclusiveMin?: string | number
  exclusiveMax?: string | number
  step?: number
}

function isAttributeValue(value: unknown): value is string | number {
  return typeof value === "string" || typeof value === "number"
}

function collectRepresentation(
  bounds: NodeBounds,
  id: string,
  payload: any,
): boolean {
  switch (id) {
    case "effect/schema/isMinLength":
      bounds.minLength = payload.minLength
      return true
    case "effect/schema/isMaxLength":
      bounds.maxLength = payload.maxLength
      return true
    case "effect/schema/isLengthBetween":
      bounds.minLength = payload.minimum
      bounds.maxLength = payload.maximum
      return true
    case "effect/schema/isPattern":
      bounds.patterns.push(new RegExp(payload.source, payload.flags))
      return true
    case "effect/schema/isGreaterThanOrEqualTo":
    case "effect/schema/isGreaterThanOrEqualToDate":
    case "effect/schema/isGreaterThanOrEqualToBigInt":
      bounds.min = payload.minimum
      return true
    case "effect/schema/isGreaterThan":
    case "effect/schema/isGreaterThanDate":
    case "effect/schema/isGreaterThanBigInt":
      bounds.exclusiveMin = payload.exclusiveMinimum
      return true
    case "effect/schema/isLessThanOrEqualTo":
    case "effect/schema/isLessThanOrEqualToDate":
    case "effect/schema/isLessThanOrEqualToBigInt":
      bounds.max = payload.maximum
      return true
    case "effect/schema/isLessThan":
    case "effect/schema/isLessThanDate":
    case "effect/schema/isLessThanBigInt":
      bounds.exclusiveMax = payload.exclusiveMaximum
      return true
    case "effect/schema/isBetween":
    case "effect/schema/isBetweenDate":
    case "effect/schema/isBetweenBigInt":
      bounds.min = payload.minimum
      bounds.max = payload.maximum
      return true
    case "effect/schema/isInt":
    case "effect/schema/isInt32":
      bounds.step ??= 1
      return true
    case "effect/schema/isMultipleOf":
      bounds.step = payload.divisor
      return true
  }
  return false
}

function collectArbitrary(
  bounds: NodeBounds,
  filter: SchemaAST.Filter<unknown> | SchemaAST.FilterGroup<unknown>,
) {
  const arbitrary = filter.annotations?.arbitrary?.constraint

  if (!arbitrary) {
    return
  }

  if (arbitrary.minLength !== undefined) {
    bounds.minLength ??= arbitrary.minLength
  }
  if (arbitrary.maxLength !== undefined) {
    bounds.maxLength ??= arbitrary.maxLength
  }
  if (arbitrary.integer) {
    bounds.step ??= 1
  }

  const ordered = arbitrary.ordered

  if (ordered?.minimum !== undefined && isAttributeValue(ordered.minimum)) {
    if (ordered.exclusiveMinimum === true) {
      bounds.exclusiveMin ??= ordered.minimum
    } else {
      bounds.min ??= ordered.minimum
    }
  }

  if (ordered?.maximum !== undefined && isAttributeValue(ordered.maximum)) {
    if (ordered.exclusiveMaximum === true) {
      bounds.exclusiveMax ??= ordered.maximum
    } else {
      bounds.max ??= ordered.maximum
    }
  }

  if (arbitrary.patterns) {
    for (const source of arbitrary.patterns) {
      bounds.patterns.push(new RegExp(source))
    }
  }
}

function collectCheck(
  bounds: NodeBounds,
  check: SchemaAST.Filter<unknown> | SchemaAST.FilterGroup<unknown>,
) {
  const representation = check.annotations?.representation

  if (
    !representation ||
    !collectRepresentation(bounds, representation.id, representation.payload)
  ) {
    collectArbitrary(bounds, check)
  }

  if (check._tag === "FilterGroup") {
    for (const nested of check.checks) {
      collectCheck(bounds, nested)
    }
  }
}

function applyChecks(
  constraint: ValidationAttributes,
  checks: SchemaAST.Checks | undefined,
  isStringLike: boolean,
) {
  if (!checks) {
    return
  }

  const bounds: NodeBounds = {
    patterns: [],
  }

  for (const check of checks) {
    collectCheck(bounds, check)
  }

  if (isStringLike) {
    if (bounds.minLength !== undefined) {
      constraint.minLength = bounds.minLength
    }
    if (bounds.maxLength !== undefined) {
      constraint.maxLength = bounds.maxLength
    }
  }

  if (bounds.step !== undefined) {
    constraint.step = bounds.step
  }

  const min =
    bounds.min ??
    (typeof bounds.exclusiveMin === "number" && bounds.step !== undefined
      ? bounds.exclusiveMin + bounds.step
      : undefined)
  const max =
    bounds.max ??
    (typeof bounds.exclusiveMax === "number" && bounds.step !== undefined
      ? bounds.exclusiveMax - bounds.step
      : undefined)

  if (min !== undefined && isAttributeValue(min)) constraint.min = min
  if (max !== undefined && isAttributeValue(max)) constraint.max = max

  if (bounds.patterns.length > 0) {
    const pattern = serializeHtmlPattern(bounds.patterns)
    if (pattern) constraint.pattern = pattern
  }
}

function getEnumPattern(ast: SchemaAST.Enum) {
  const values = ast.enums.reduce<string[]>((values, [, value]) => {
    if (typeof value === "string") {
      values.push(
        value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&").replace(/-/g, "\\x2d"),
      )
    }
    return values
  }, [])

  if (!values.length) {
    return
  }

  return values.join("|")
}

function isStringLiteralUnion(ast: SchemaAST.Union): boolean {
  return ast.types.length > 0 && ast.types.every(
    (type) => SchemaAST.isLiteral(type) && typeof type.literal === "string",
  )
}

function getStringLiteralsPattern(ast: SchemaAST.Union): string | undefined {
  const values: Array<string> = []

  for (const type of ast.types) {
    if (SchemaAST.isLiteral(type) && typeof type.literal === "string") {
      values.push(type.literal)
    }
  }

  if (!values.length) {
    return
  }

  return values
    .map((value) =>
      value
        .replace(/[|\\{}()[\]^$+*?.]/g, "\\$&")
        .replace(/-/g, "\\x2d"),
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

export function getEffectConstraint(
  schema: Schema.Top,
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

    if (
      SchemaAST.isDeclaration(ast) &&
      ast.typeParameters.length > 0 &&
      SchemaAST.isObjects(ast.typeParameters[0])
    ) {
      updateConstraint(ast.typeParameters[0], data, name)
      processingPaths.delete(ast)
      return
    }

    if (SchemaAST.isUnion(ast)) {
      const meaningfulTypes = ast.types.filter(
        (type) => !SchemaAST.isUndefined(type) && !SchemaAST.isNull(type),
      )

      if (meaningfulTypes.length > 0) {
        const branchConstraints = meaningfulTypes.map((type) => {
          const branchResult: Record<string, ValidationAttributes> = {}
          updateConstraint(type, branchResult, name)
          return branchResult
        })

        const merged =
          branchConstraints.length === 1
            ? branchConstraints[0]
            : branchConstraints.reduce(mergeBranchConstraints)

        for (const key of Object.keys(merged)) {
          const existing = data[key]

          if (existing) {
            for (const constraintKey of constraintKeys) {
              if (constraintKey === "required") continue
              if (merged[key][constraintKey] !== undefined) {
                assignConstraintValue(
                  existing,
                  constraintKey,
                  merged[key][constraintKey],
                )
              }
            }
          } else {
            data[key] = merged[key]
          }
        }
      }

      if (name !== "" && isStringLiteralUnion(ast)) {
        const pattern = getStringLiteralsPattern(ast)

        if (pattern) {
          getConstraintEntry(data, name).pattern = pattern
        }
      }

      processingPaths.delete(ast)
      return
    }

    if (name === "") {
      processingPaths.delete(ast)
      return
    }

    const constraint = getConstraintEntry(data, name)
    applyChecks(constraint, ast.checks, isStringLikeAst(ast))

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

    if (isFileAst(ast)) {
      const accept = ast.annotations?.accept
      if (typeof accept === "string") {
        constraint.accept = accept
      }
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

    return
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
