export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

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
