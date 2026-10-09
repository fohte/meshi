import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

import type { FoodSearchService } from '#domain/food-browse/food-search-service'
import type { FoodMasterService } from '#domain/food-master/service'
import type { MealHistoryService } from '#domain/meal-history/types'
import type { MealLogService } from '#domain/meal-log/meal-log-service'
import type { UserProfileService } from '#domain/user-profile/user-profile-service'
import type { Logger } from '#logger'
import { registerDeleteMealLogTool } from '#mcp-tools/delete-meal-log'
import { registerFoodFromCompositionTool } from '#mcp-tools/food-composition'
import { registerMealLoggingTools } from '#mcp-tools/meal-logging'
import {
  buildProfilePayload,
  errorResult,
  TOOL_CALLED,
  TOOL_SUCCEEDED,
} from '#mcp-tools/payloads'
import { registerQueryMealsTool } from '#mcp-tools/query-meals'
import { registerRecommendationContextTool } from '#mcp-tools/recommendation'
import { registerFoodTool } from '#mcp-tools/register-food'
import { profileStructuredOutput, updateProfileInput } from '#mcp-tools/schemas'
import { registerUpdateMealLogTool } from '#mcp-tools/update-meal-log'

export interface MeshiToolDeps {
  readonly mealHistoryService: MealHistoryService
  readonly profileService: UserProfileService
  readonly foodSearchService: FoodSearchService
  readonly mealLogService: MealLogService
  readonly foodMasterService: FoodMasterService
  readonly logger: Logger
}

export const registerMeshiTools = (
  server: McpServer,
  deps: MeshiToolDeps,
): void => {
  const {
    mealHistoryService,
    profileService,
    foodSearchService,
    foodMasterService,
    mealLogService,
    logger,
  } = deps

  registerMealLoggingTools(server, {
    foodSearchService,
    mealLogService,
    logger,
  })
  registerFoodFromCompositionTool(server, { foodMasterService, logger })

  registerFoodTool(server, { foodMasterService, logger })

  registerQueryMealsTool(server, { mealHistoryService, logger })
  registerDeleteMealLogTool(server, { mealLogService, logger })
  registerUpdateMealLogTool(server, {
    mealLogService,
    foodMasterService,
    logger,
  })
  registerRecommendationContextTool(server, {
    mealHistoryService,
    profileService,
    logger,
  })

  server.registerTool(
    'get_profile',
    {
      description: '現在のプロファイルを返す。',
      inputSchema: z.object({}),
      outputSchema: profileStructuredOutput,
      annotations: { readOnlyHint: true },
    },
    async () => {
      logger.log(TOOL_CALLED, { tool: 'get_profile' })
      // Guards a synchronous throw from the .match() callbacks below (profileService itself can no longer reject) so it gets structured TOOL_FAILED logging via errorResult() instead of the MCP SDK's own generic isError fallback.
      // eslint-disable-next-line no-restricted-syntax -- see comment above
      try {
        return await profileService.get().match(
          (profile) => {
            const payload = buildProfilePayload(profile)
            logger.log(TOOL_SUCCEEDED, { tool: 'get_profile' })
            return {
              content: [
                { type: 'text' as const, text: 'プロファイルを取得しました。' },
              ],
              structuredContent: payload,
            }
          },
          (err) => errorResult(logger, 'get_profile', err),
        )
      } catch (err) {
        return errorResult(logger, 'get_profile', err)
      }
    },
  )

  server.registerTool(
    'update_profile',
    {
      description: 'プロファイル項目の部分更新。',
      inputSchema: updateProfileInput,
      outputSchema: profileStructuredOutput,
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'update_profile' })
      // Guards a synchronous throw from the .match() callbacks below (profileService itself can no longer reject) so it gets structured TOOL_FAILED logging via errorResult() instead of the MCP SDK's own generic isError fallback.
      // eslint-disable-next-line no-restricted-syntax -- see comment above
      try {
        return await profileService
          .update({
            ...(args.likes === undefined ? {} : { likes: args.likes }),
            ...(args.dislikes === undefined ? {} : { dislikes: args.dislikes }),
            ...(args.allergies === undefined
              ? {}
              : { allergies: args.allergies }),
            ...(args.constraints === undefined
              ? {}
              : { constraints: args.constraints }),
            ...(args.daily_targets === undefined
              ? {}
              : { dailyTargets: args.daily_targets }),
          })
          .match(
            (profile) => {
              const payload = buildProfilePayload(profile)
              logger.log(TOOL_SUCCEEDED, { tool: 'update_profile' })
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: 'プロファイルを更新しました。',
                  },
                ],
                structuredContent: payload,
              }
            },
            (err) => errorResult(logger, 'update_profile', err),
          )
      } catch (err) {
        return errorResult(logger, 'update_profile', err)
      }
    },
  )
}
