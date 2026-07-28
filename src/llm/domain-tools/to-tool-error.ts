import type { DomainError } from '#domain/meal-log/errors'
import type { ToolError } from '#llm/domain-tools/types'

export const toToolError = (e: DomainError): ToolError => ({
  code: e.code,
  message: e.message,
})
