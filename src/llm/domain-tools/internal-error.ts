import { err, type Result, type ToolError } from '@/llm/domain-tools/types'

export const toInternalToolError = (e: unknown): ToolError => ({
  code: 'internal_error',
  message: e instanceof Error ? e.message : String(e),
})

export const internalErr = (e: unknown): Result<never, ToolError> =>
  err(toInternalToolError(e))
