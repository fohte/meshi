import { z } from 'zod'

import type { MealLogService } from '#domain/meal-log/meal-log-service'
import { MEAL_TYPES } from '#domain/meal-log/types'
import { isValidJstCalendarDateString } from '#lib/jst-date'
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
  date: z.string().refine(isValidJstCalendarDateString, {
    message: 'date must be a valid YYYY-MM-DD JST calendar date',
  }),
  meal_type: z.enum(MEAL_TYPES),
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
    "Persist a meal log entry for a known food_master. Returns the assigned meal_log_id and the scaled nutrition for the recorded quantity. meal_type is required and must be exactly what the user stated (e.g. breakfast/lunch/dinner/snack) — it is never inferred or guessed from date or time of day; if the user has not said which meal this is, ask them before calling this tool (this tool does not ask on its own — that's the calling agent's job). date must be the YYYY-MM-DD JST calendar date the meal was eaten, resolved against the occurred_at/timezone given in the system meta the same way other dates in this conversation are. unit=g/kg/mg always works; any other unit (個/杯/ml/...) must already be defined for this food_master or this call fails with meal_log/unknown_unit — call register_food_master_unit with a plausible grams_per_unit for that unit, then retry. food_name must be the exact name string this food_master_id was just resolved to (register_food_master output or a search_food_master candidate) — it is checked against the actual food_master and the call fails with meal_log/food_name_mismatch on a mismatch, catching a mixed-up food_master_id before it is recorded.",
  inputSchema: z.toJSONSchema(inputSchema, { io: 'input' }),
  async execute(
    input: unknown,
  ): Promise<Result<RecordMealLogOutput, ToolError>> {
    const parsed = parseToolInput(inputSchema, input)
    if (parsed.isErr()) return err(parsed.error)
    const result = await service.record({
      foodMasterId: parsed.value.food_master_id,
      foodName: parsed.value.food_name,
      eatenDate: parsed.value.date,
      mealType: parsed.value.meal_type,
      quantity: parsed.value.quantity,
      unit: parsed.value.unit,
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
