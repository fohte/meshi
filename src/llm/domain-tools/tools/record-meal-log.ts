import { z } from 'zod'

import type { MealLogService } from '#domain/meal-log/meal-log-service'
import { MEAL_TYPES } from '#domain/meal-log/types'
import { NON_BLANK, parseToolInput } from '#llm/domain-tools/parse'
import { toToolError } from '#llm/domain-tools/to-tool-error'
import {
  type DomainTool,
  err,
  ok,
  type Result,
  type ToolError,
} from '#llm/domain-tools/types'

const inputSchema = z.object({
  food_master_id: z.string().min(1),
  food_name: z.string().min(1).regex(NON_BLANK),
  eaten_at_iso: z.iso.datetime({ offset: true }),
  meal_type: z.enum(MEAL_TYPES).optional(),
  quantity: z.number().positive(),
  unit: z.string().min(1),
})

export interface RecordMealLogOutput {
  readonly meal_log_id: string
  readonly nutrition: Readonly<Record<string, number>>
  readonly is_estimated: boolean
}

export const createRecordMealLogTool = (
  service: MealLogService,
): DomainTool => ({
  name: 'record_meal_log',
  description:
    'Persist a meal log entry for a known food_master. Returns the assigned meal_log_id and the scaled nutrition for the recorded quantity. Pass meal_type when the user names it (e.g. breakfast/lunch/dinner/snack); when omitted, it defaults to a time-of-day estimate derived from eaten_at_iso. unit=g/kg/mg always works; any other unit (個/杯/ml/...) must already be defined for this food_master or this call fails with meal_log/unknown_unit — call register_food_master_unit with a plausible grams_per_unit for that unit, then retry. food_name must be the exact name string this food_master_id was just resolved to (register_food_master output or a search_food_master candidate) — it is checked against the actual food_master and the call fails with meal_log/food_name_mismatch on a mismatch, catching a mixed-up food_master_id before it is recorded.',
  inputSchema: z.toJSONSchema(inputSchema, { io: 'input' }),
  async execute(
    input: unknown,
  ): Promise<Result<RecordMealLogOutput, ToolError>> {
    const parsed = parseToolInput(inputSchema, input)
    if (parsed.isErr()) return err(parsed.error)
    const result = await service.record({
      foodMasterId: parsed.value.food_master_id,
      foodName: parsed.value.food_name,
      eatenAt: new Date(parsed.value.eaten_at_iso),
      quantity: parsed.value.quantity,
      unit: parsed.value.unit,
      ...(parsed.value.meal_type === undefined
        ? {}
        : { mealType: parsed.value.meal_type }),
    })
    if (result.isErr()) {
      return err(toToolError(result.error))
    }
    return ok({
      meal_log_id: result.value.id,
      nutrition: result.value.nutrition,
      is_estimated: result.value.isEstimated,
    })
  },
})
