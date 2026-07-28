import type { FormError } from "@conform-to/dom/future"
import { appendPath } from "@conform-to/dom/future"
import { Exit, Result, Schema, SchemaIssue } from "effect"

type FormatIssue = ReturnType<typeof formatSchemaIssue>["issues"][number]

type SchemaIssueFormatter = (issue: SchemaIssue.Issue) => {
  issues: ReadonlyArray<{
    message: string
    path?: ReadonlyArray<unknown>
  }>
}

const formatSchemaIssue: SchemaIssueFormatter =
  SchemaIssue.makeFormatterStandardSchemaV1()

function getIssuePath(issue: FormatIssue) {
  return (issue.path ?? []).reduce<string>((name, segment) => {
    if (typeof segment !== "string" && typeof segment !== "number") {
      throw new Error(
        `Only string or numeric path segment keys are supported. Received segment: ${String(segment)}`,
      )
    }

    return appendPath(name, segment)
  }, "")
}

function createFormError<ErrorShape = string[]>(
  issues: ReadonlyArray<FormatIssue>,
  formatFieldIssues?: (issues: Array<FormatIssue>, name: string) => ErrorShape,
): FormError<string[] | ErrorShape> | null {
  if (!issues.length) {
    return null
  }

  const issuesByName: Record<string, Array<FormatIssue>> = {}

  for (const issue of issues) {
    const name = getIssuePath(issue)
    issuesByName[name] ??= []
    issuesByName[name].push(issue)
  }

  const fieldErrors: Record<string, string[] | ErrorShape> = {}
  let formErrors: string[] | ErrorShape | null = null

  for (const name of Object.keys(issuesByName)) {
    const formatted = formatFieldIssues
      ? formatFieldIssues(issuesByName[name], name)
      : issuesByName[name].map((issue) => issue.message)

    if (name === "") {
      formErrors = formatted
    } else {
      fieldErrors[name] = formatted
    }
  }

  return {
    formErrors,
    fieldErrors,
  }
}

/**
 * Transforms an Effect `Result` into Conform's error format.
 *
 * **Example:**
 * ```ts
 * const result = Schema.decodeUnknownResult(schema)(formData);
 * const error = formatResult(result);
 * ```
 */
export function formatResult<A>(
  result: Result.Result<A, Schema.SchemaError>,
): FormError<string[]> | null
export function formatResult<A, ErrorShape>(
  result: Result.Result<A, Schema.SchemaError>,
  options: {
    /** Whether to include the parsed value in the returned object */
    includeValue: true
    /** Custom function to format validation issues for each field */
    formatIssues: (issues: Array<FormatIssue>, name: string) => ErrorShape
  },
): {
  error: FormError<ErrorShape> | null
  value: A | undefined
}
export function formatResult<A>(
  result: Result.Result<A, Schema.SchemaError>,
  options: {
    /** Whether to include the parsed value in the returned object */
    includeValue: true
    /** Custom function to format validation issues for each field */
    formatIssues?: undefined
  },
): {
  error: FormError<string[]> | null
  value: A | undefined
}
export function formatResult<A, ErrorShape>(
  result: Result.Result<A, Schema.SchemaError>,
  options: {
    /** Whether to include the parsed value in the returned object */
    includeValue?: false
    /** Custom function to format validation issues for each field */
    formatIssues: (issues: Array<FormatIssue>, name: string) => ErrorShape
  },
): FormError<ErrorShape> | null
export function formatResult<A, ErrorShape = string[]>(
  result: Result.Result<A, Schema.SchemaError>,
  options?: {
    /** Whether to include the parsed value in the returned object */
    includeValue?: boolean
    /** Custom function to format validation issues for each field */
    formatIssues?: (issues: Array<FormatIssue>, name: string) => ErrorShape
  },
):
  | FormError<string[] | ErrorShape>
  | {
      error: FormError<string[] | ErrorShape> | null
      value: A | undefined
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

/**
 * Transforms an Effect `Exit` (from `Effect.runPromiseExit`) into Conform's
 * error format, for use with async / effectful schemas.
 *
 * **Example:**
 * ```ts
 * import { Effect, Exit } from "effect"
 * import { coerceFormValue, formatExit } from "conform-to-effect"
 *
 * async function validateSchema(schema, payload) {
 *   const exit = await Effect.runPromiseExit(
 *     Schema.decodeUnknown(coerceFormValue(schema), { errors: "all" })(payload)
 *   )
 *   if (Exit.isSuccess(exit)) {
 *     return { error: null, value: exit.value }
 *   }
 *   return formatExit(exit, { includeValue: true })
 * }
 * ```
 */
export function formatExit<A>(
  exit: Exit.Exit<A, unknown>,
): FormError<string[]> | null
export function formatExit<A, ErrorShape>(
  exit: Exit.Exit<A, unknown>,
  options: {
    includeValue: true
    formatIssues: (issues: Array<FormatIssue>, name: string) => ErrorShape
  },
): {
  error: FormError<ErrorShape> | null
  value: A | undefined
}
export function formatExit<A>(
  exit: Exit.Exit<A, unknown>,
  options: {
    includeValue: true
    formatIssues?: undefined
  },
): {
  error: FormError<string[]> | null
  value: A | undefined
}
export function formatExit<A, ErrorShape>(
  exit: Exit.Exit<A, unknown>,
  options: {
    includeValue?: false
    formatIssues: (issues: Array<FormatIssue>, name: string) => ErrorShape
  },
): FormError<ErrorShape> | null
export function formatExit<A, ErrorShape = string[]>(
  exit: Exit.Exit<A, unknown>,
  options?: {
    includeValue?: boolean
    formatIssues?: (issues: Array<FormatIssue>, name: string) => ErrorShape
  },
):
  | FormError<string[] | ErrorShape>
  | {
      error: FormError<string[] | ErrorShape> | null
      value: A | undefined
    }
  | null {
  if (Exit.isSuccess(exit)) {
    return options?.includeValue
      ? { error: null, value: exit.value }
      : null
  }

  const reasons = (exit.cause as any)?.reasons
  const firstError =
    Array.isArray(reasons) && reasons.length > 0
      ? reasons[0].error
      : undefined
  const issue = (firstError as any)?.issue as SchemaIssue.Issue | undefined

  if (!issue) {
    const fallback: FormError<string[]> = {
      formErrors: ["Unexpected error"],
      fieldErrors: {},
    }

    return options?.includeValue
      ? { error: fallback, value: undefined }
      : fallback
  }

  const error = createFormError(
    formatSchemaIssue(issue).issues,
    options?.formatIssues,
  )

  if (options?.includeValue) {
    return { error, value: undefined }
  }

  return error
}
