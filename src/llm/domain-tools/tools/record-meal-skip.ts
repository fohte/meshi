import { z } from 'zod'

import { MEAL_TYPES } from '#domain/meal-log/types'
import type { MealSkipService } from '#domain/meal-skip/meal-skip-service'
import { parseToolInput } from '#llm/domain-tools/parse'
import { mealSkipInputSchema as inputSchema } from '#llm/domain-tools/tools/meal-skip-input-schema'
import {
  type DomainTool,
  err,
  ok,
  type Result,
  type ToolError,
} from '#llm/domain-tools/types'

export interface RecordMealSkipOutput {
  readonly meal_skip_id: string
  readonly date: string
  readonly meal_type: (typeof MEAL_TYPES)[number]
}

export const createRecordMealSkipTool = (
  service: MealSkipService,
): DomainTool => ({
  name: 'record_meal_skip',
  description:
    'Record that the user did not eat a given meal (breakfast/lunch/dinner/snack) on a given date — a deliberate "skipped this meal" fact, distinct from simply having no meal_log entries for that meal_type. Use this only when the user explicitly says they skipped/missed/did not eat that meal (e.g. "朝ごはん食べなかった", "I skipped lunch today") — never just because nothing has been logged yet for that meal_type. date must be the YYYY-MM-DD calendar date the user means, resolved against the occurred_at/timezone given in the system meta (a bare "today"/"yesterday" or month/day resolves the same way record_meal_log\'s date field does). If meal_log entries already exist for that date and meal_type, this call still succeeds but the day view shows the actual meal instead of the skip — it never deletes or conflicts with meal_log entries, so never call this to "undo" or "correct" a meal_log entry; use update_meal_log or the correction flow instead. Calling this again for an already-skipped date+meal_type is safe and just returns the existing record.',
  inputSchema: z.toJSONSchema(inputSchema, { io: 'input' }),
  async execute(
    input: unknown,
  ): Promise<Result<RecordMealSkipOutput, ToolError>> {
    const parsed = parseToolInput(inputSchema, input)
    if (parsed.isErr()) return err(parsed.error)
    const result = await service.record({
      date: parsed.value.date,
      mealType: parsed.value.meal_type,
    })
    if (result.isErr()) {
      return err({ code: result.error.code, message: result.error.message })
    }
    return ok({
      meal_skip_id: result.value.id,
      date: result.value.date,
      meal_type: result.value.mealType,
    })
  },
})
