import { z } from 'zod'

import type { MealLogService } from '#domain/meal-log/meal-log-service'
import { MEAL_TYPES } from '#domain/meal-log/types'
import { jstDateSchema } from '#lib/jst-date'
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
  date: jstDateSchema,
  meal_type: z.enum(MEAL_TYPES),
  quantity: z.number().positive(),
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
    "Persist a meal log entry for a known food_master. quantity is a multiplier against that food_master's own registered nutrition (e.g. quantity=2 for two of whatever single unit, serving, or item that food_master's nutrition was registered per). Returns the assigned meal_log_id and the scaled nutrition for the recorded quantity. meal_type is required and must be exactly what the user stated (e.g. breakfast/lunch/dinner/snack) — it is never inferred or guessed from date or time of day; if the user has not said which meal this is, ask them before calling this tool (this tool does not ask on its own — that's the calling agent's job). date must be the YYYY-MM-DD JST calendar date the meal was eaten, resolved against the occurred_at/timezone given in the system meta the same way other dates in this conversation are. food_name must be the exact name string this food_master_id was just resolved to (register_food_master output or a search_food_master candidate) — it is checked against the actual food_master and the call fails with meal_log/food_name_mismatch on a mismatch, catching a mixed-up food_master_id before it is recorded.",
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
