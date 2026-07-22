import type { Result } from 'neverthrow'

export { err, ok, type Result } from 'neverthrow'

export interface ToolError {
  readonly code: string
  readonly message: string
  readonly details?: Readonly<Record<string, unknown>>
}

export type DomainToolName =
  | 'record_meal_log'
  | 'search_food_master'
  | 'register_food_master'
  | 'query_meal_history'
  | 'get_user_profile'
  | 'update_user_profile'
  | 'web_search'

export interface DomainTool {
  readonly name: DomainToolName
  readonly description: string
  readonly inputSchema: Readonly<Record<string, unknown>>
  execute(input: unknown): Promise<Result<unknown, ToolError>>
}
