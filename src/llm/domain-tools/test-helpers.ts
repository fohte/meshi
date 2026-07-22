import type { Result, ToolError } from '@/llm/domain-tools/types'

// Tool error messages come from upstream sources (Zod, DomainError, fetch) and
// drift across library versions and locales.
export interface NormalizedToolError {
  readonly code: string
  readonly message: '<dynamic>'
  readonly details?: Readonly<Record<string, unknown>>
}

export type NormalizedResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: NormalizedToolError }

// Zod issue text is implementation-defined.
const normalizeDetails = (
  details: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> => {
  if (!('issues' in details)) return details
  const { issues, ...rest } = details
  return {
    ...rest,
    issues: Array.isArray(issues)
      ? { count: issues.length }
      : { count: 'non-array' },
  }
}

export const normalizeResult = <T>(
  result: Result<T, ToolError>,
): NormalizedResult<T> => {
  if (result.isOk()) return { ok: true, value: result.value }
  const { details, code } = result.error
  return {
    ok: false,
    error: {
      code,
      message: '<dynamic>',
      ...(details === undefined ? {} : { details: normalizeDetails(details) }),
    },
  }
}
