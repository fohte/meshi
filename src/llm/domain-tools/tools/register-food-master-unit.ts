import { z } from 'zod'

import type { FoodMasterUnitService } from '#domain/food-master-unit/service'
import { NON_BLANK, parseToolInput } from '#llm/domain-tools/parse'
import {
  type DomainTool,
  err,
  type Result,
  type ToolError,
} from '#llm/domain-tools/types'

const inputSchema = z.object({
  food_master_id: z.string().min(1),
  unit: z.string().min(1).regex(NON_BLANK),
  grams_per_unit: z.number().positive(),
})

export interface RegisterFoodMasterUnitOutput {
  readonly food_master_id: string
  readonly unit: string
  readonly grams_per_unit: number
}

export const createRegisterFoodMasterUnitTool = (
  service: FoodMasterUnitService,
): DomainTool => ({
  name: 'register_food_master_unit',
  description:
    'Define how many grams one <unit> of an existing food_master weighs (e.g. 個=55g, 杯=150g, ml=1.04g). Use this when record_meal_log fails with meal_log/unknown_unit: register the unit named in that error with a plausible grams_per_unit for this specific food, then retry record_meal_log.',
  inputSchema: z.toJSONSchema(inputSchema, { io: 'input' }),
  async execute(
    input: unknown,
  ): Promise<Result<RegisterFoodMasterUnitOutput, ToolError>> {
    const parsed = parseToolInput(inputSchema, input)
    if (parsed.isErr()) return err(parsed.error)
    return await service
      .register({
        foodMasterId: parsed.value.food_master_id,
        unit: parsed.value.unit,
        gramsPerUnit: parsed.value.grams_per_unit,
      })
      .map((unit) => ({
        food_master_id: unit.foodMasterId,
        unit: unit.unit,
        grams_per_unit: unit.gramsPerUnit,
      }))
      .mapErr((e): ToolError => ({
        code: `food_master_unit/${e.code}`,
        message: e.message,
        details: e.details,
      }))
  },
})
