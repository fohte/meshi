import { z } from 'zod'

import { err, ok, type Result, type ToolError } from '@/llm/domain-tools/types'

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
