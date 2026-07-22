import { z } from 'zod'

import type { FoodMasterService } from '@/domain/food-master/service'
import { parseToolInput } from '@/llm/domain-tools/parse'
import {
  type DomainTool,
  err,
  type Result,
  type ToolError,
} from '@/llm/domain-tools/types'

const inputSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)).optional(),
  nutrition_per_100g: z.record(z.string(), z.number().nonnegative()),
  source: z.enum(['web_search', 'composition_table_estimate', 'user_input']),
  is_estimated: z.boolean(),
  source_url: z.url().optional(),
})

export interface RegisterFoodMasterOutput {
  readonly food_master_id: string
}

export const createRegisterFoodMasterTool = (
  service: FoodMasterService,
): DomainTool => ({
  name: 'register_food_master',
  description:
    'Register a new food_master row with per-100g nutrition values. Use source=web_search with a source_url for confirmed values, composition_table_estimate (is_estimated=true) for fallbacks.',
  inputSchema: z.toJSONSchema(inputSchema, { io: 'input' }),
  async execute(
    input: unknown,
  ): Promise<Result<RegisterFoodMasterOutput, ToolError>> {
    const parsed = parseToolInput(inputSchema, input)
    if (parsed.isErr()) return err(parsed.error)
    return await service
      .register({
        name: parsed.value.name,
        nutrition: parsed.value.nutrition_per_100g,
        source: parsed.value.source,
        isEstimated: parsed.value.is_estimated,
        ...(parsed.value.aliases === undefined
          ? {}
          : { aliases: parsed.value.aliases }),
        ...(parsed.value.source_url === undefined
          ? {}
          : { sourceUrl: parsed.value.source_url }),
      })
      .map((master) => ({ food_master_id: master.id }))
      .mapErr((e): ToolError => ({
        code: `food_master/${e.code}`,
        message: e.message,
        details: e.details,
      }))
  },
})
