import { z } from 'zod'

import { err, ok, type Result, type ToolError } from '#llm/domain-tools/types'

// Rejects both the empty string and whitespace-only strings, matching the
// trim-then-check-empty rule domain repositories apply to free-text fields
// (e.g. normalizeAndValidate in food-master/repository.ts).
export const NON_BLANK = /\S/

export const parseToolInput = <T>(
  schema: z.ZodType<T>,
  input: unknown,
): Result<T, ToolError> => {
  const parsed = schema.safeParse(input)
  if (parsed.success) return ok(parsed.data)
  return err({
    code: 'invalid_input',
    message: parsed.error.message,
    details: { issues: parsed.error.issues },
  })
}
