import type {
  LlmToolCall,
  LlmToolExecutionResult,
  LlmToolSchema,
} from '@/adapters/llm/types'
import type { WebSearchClient } from '@/adapters/web-search/web-search-client'
import type { FoodMasterService } from '@/domain/food-master/service'
import type { FoodMatcher } from '@/domain/food-matcher/food-matcher'
import type { MealHistoryService } from '@/domain/meal-history/types'
import type { MealLogService } from '@/domain/meal-log/meal-log-service'
import type { UserProfileService } from '@/domain/user-profile/user-profile-service'
import { createGetUserProfileTool } from '@/llm/domain-tools/tools/get-user-profile'
import { createQueryMealHistoryTool } from '@/llm/domain-tools/tools/query-meal-history'
import { createRecordMealLogTool } from '@/llm/domain-tools/tools/record-meal-log'
import { createRegisterFoodMasterTool } from '@/llm/domain-tools/tools/register-food-master'
import { createSearchFoodMasterTool } from '@/llm/domain-tools/tools/search-food-master'
import { createUpdateUserProfileTool } from '@/llm/domain-tools/tools/update-user-profile'
import { createWebSearchTool } from '@/llm/domain-tools/tools/web-search'
import type { DomainTool, ToolError } from '@/llm/domain-tools/types'

const safeStringify = (value: unknown): string | null => {
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

const encodeValue = (value: unknown): LlmToolExecutionResult => {
  const content = safeStringify(value)
  if (content === null) {
    return encodeError({
      code: 'internal_error',
      message: 'failed to serialize tool result',
    })
  }
  return { content }
}

const encodeError = (error: ToolError): LlmToolExecutionResult => {
  const content =
    safeStringify({ error }) ??
    JSON.stringify({
      error: {
        code: 'internal_error',
        message: 'failed to serialize tool error',
      },
    })
  return { content, isError: true }
}

export interface DomainToolsDeps {
  readonly mealLogService: MealLogService
  readonly foodMasterService: FoodMasterService
  readonly foodMatcher: FoodMatcher
  readonly mealHistoryService: MealHistoryService
  readonly userProfileService: UserProfileService
  readonly webSearchClient: WebSearchClient
}

export interface DomainToolsRegistry {
  list(): ReadonlyArray<DomainTool>
  get(name: string): DomainTool | undefined
  toLlmSchemas(): ReadonlyArray<LlmToolSchema>
  executeToolUse(call: LlmToolCall): Promise<LlmToolExecutionResult>
}

export const createDomainToolsRegistry = (
  deps: DomainToolsDeps,
): DomainToolsRegistry => {
  const tools: ReadonlyArray<DomainTool> = [
    createRecordMealLogTool(deps.mealLogService),
    createSearchFoodMasterTool(deps.foodMatcher),
    createRegisterFoodMasterTool(deps.foodMasterService),
    createQueryMealHistoryTool(deps.mealHistoryService),
    createGetUserProfileTool(deps.userProfileService),
    createUpdateUserProfileTool(deps.userProfileService),
    createWebSearchTool(deps.webSearchClient),
  ]
  const byName = new Map<string, DomainTool>(tools.map((t) => [t.name, t]))

  return {
    list: () => tools,
    get: (name) => byName.get(name),
    toLlmSchemas: () =>
      tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    async executeToolUse(call) {
      const tool = byName.get(call.name)
      if (tool === undefined) {
        return encodeError({
          code: 'unknown_tool',
          message: `unknown tool: ${call.name}`,
        })
      }
      const result = await tool.execute(call.input)
      if (result.ok) {
        return encodeValue(result.value)
      }
      return encodeError(result.error)
    },
  }
}
