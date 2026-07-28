import type { FormError } from "@conform-to/dom/future"
import { appendPath } from "@conform-to/dom/future"
import { Exit, Result, Schema, SchemaIssue } from "effect"

type Formatter = (issue: SchemaIssue.Issue) => {
  issues: ReadonlyArray<{
    message: string
    path?: ReadonlyArray<unknown>
  }>
}

const formatSchemaIssue: Formatter = SchemaIssue.makeFormatterStandardSchemaV1()

function flattenIssues(
  issue: SchemaIssue.Issue,
): Array<{ issue: SchemaIssue.Issue; path: Array<string | number> }> {
  const results: Array<{
    issue: SchemaIssue.Issue
    path: Array<string | number>
  }> = []

  function walk(issue: SchemaIssue.Issue, path: Array<string | number>): void {
    if (issue._tag === "Composite") {
      for (const child of issue.issues) {
        walk(child, path)
      }
      return
    }

    if (issue._tag === "Pointer") {
      walk(issue.issue, [
        ...path,
        ...issue.path.filter(
          (s): s is string | number =>
            typeof s === "string" || typeof s === "number",
        ),
      ])
      return
    }

    results.push({ issue: issue, path: path })
  }

  walk(issue, [])
  return results
}

function formatPath(segments: Array<string | number>): string {
  return segments.reduce<string>(
    (name, segment) => appendPath(name, segment),
    "",
  )
}

function createFormError<ErrorShape = string[]>(
  issue: SchemaIssue.Issue,
  formatFieldIssues?: (
    issues: Array<SchemaIssue.Issue>,
    name: string,
  ) => ErrorShape,
): FormError<string[] | ErrorShape> | null {
  const flat = flattenIssues(issue)

  if (!flat.length) {
    return null
  }

  const issuesByName: Record<string, Array<SchemaIssue.Issue>> = {}

  for (const { issue: leaf, path } of flat) {
    const name = formatPath(path)
    issuesByName[name] ??= []
    issuesByName[name].push(leaf)
  }

  const fieldErrors: Record<string, string[] | ErrorShape> = {}
  let formErrors: string[] | ErrorShape | null = null

  for (const name of Object.keys(issuesByName)) {
    const formatted = formatFieldIssues
      ? formatFieldIssues(issuesByName[name], name)
      : issuesByName[name].flatMap((issue) =>
          formatSchemaIssue(issue).issues.map((i) => i.message),
        )

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
    includeValue: true
    formatIssues: (issues: Array<SchemaIssue.Issue>, name: string) => ErrorShape
  },
): {
  error: FormError<ErrorShape> | null
  value: A | undefined
}
export function formatResult<A>(
  result: Result.Result<A, Schema.SchemaError>,
  options: {
    includeValue: true
    formatIssues?: undefined
  },
): {
  error: FormError<string[]> | null
  value: A | undefined
}
export function formatResult<A, ErrorShape>(
  result: Result.Result<A, Schema.SchemaError>,
  options: {
    includeValue?: false
    formatIssues: (issues: Array<SchemaIssue.Issue>, name: string) => ErrorShape
  },
): FormError<ErrorShape> | null
export function formatResult<A, ErrorShape = string[]>(
  result: Result.Result<A, Schema.SchemaError>,
  options?: {
    includeValue?: boolean
    formatIssues?: (
      issues: Array<SchemaIssue.Issue>,
      name: string,
    ) => ErrorShape
  },
):
  | FormError<string[] | ErrorShape>
  | {
      error: FormError<string[] | ErrorShape> | null
      value: A | undefined
    }
  | null {
  const error = Result.isFailure(result)
    ? createFormError(result.failure.issue, options?.formatIssues)
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
 *     Schema.decodeUnknownEffect(coerceFormValue(schema), { errors: "all" })(payload)
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
    formatIssues: (issues: Array<SchemaIssue.Issue>, name: string) => ErrorShape
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
    formatIssues: (issues: Array<SchemaIssue.Issue>, name: string) => ErrorShape
  },
): FormError<ErrorShape> | null
export function formatExit<A, ErrorShape = string[]>(
  exit: Exit.Exit<A, unknown>,
  options?: {
    includeValue?: boolean
    formatIssues?: (
      issues: Array<SchemaIssue.Issue>,
      name: string,
    ) => ErrorShape
  },
):
  | FormError<string[] | ErrorShape>
  | {
      error: FormError<string[] | ErrorShape> | null
      value: A | undefined
    }
  | null {
  if (Exit.isSuccess(exit)) {
    return options?.includeValue ? { error: null, value: exit.value } : null
  }

  const reasons = (exit.cause as any)?.reasons
  const firstError =
    Array.isArray(reasons) && reasons.length > 0 ? reasons[0].error : undefined
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

  const error = createFormError(issue, options?.formatIssues)

  if (options?.includeValue) {
    return { error, value: undefined }
  }

  return error
}
