import type { ValidationAttributes } from "@conform-to/dom/future"
import { Schema } from "effect"
import { getEffectConstraint } from "./constraint.js"

/**
 * Type guard to check if a value is an Effect schema.
 */
export function isSchema(schema: unknown): schema is Schema.Top {
  return Schema.isSchema(schema)
}

/**
 * Extracts HTML validation attributes from an Effect schema.
 */
export function getConstraints(
  schema: unknown,
): Record<string, ValidationAttributes> | undefined {
  if (!isSchema(schema)) {
    return undefined
  }

  return getEffectConstraint(schema)
}
