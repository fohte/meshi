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

export interface CancelMealSkipOutput {
  readonly date: string
  readonly meal_type: (typeof MEAL_TYPES)[number]
}

export const createCancelMealSkipTool = (
  service: MealSkipService,
): DomainTool => ({
  name: 'cancel_meal_skip',
  description:
    'Undo a previously recorded meal skip (see record_meal_skip) for a specific date and meal_type — use when the user says they were wrong about having skipped that meal. Fails with meal_skip/not_found if no skip is recorded for that date and meal_type.',
  inputSchema: z.toJSONSchema(inputSchema, { io: 'input' }),
  async execute(
    input: unknown,
  ): Promise<Result<CancelMealSkipOutput, ToolError>> {
    const parsed = parseToolInput(inputSchema, input)
    if (parsed.isErr()) return err(parsed.error)
    const result = await service.cancel({
      date: parsed.value.date,
      mealType: parsed.value.meal_type,
    })
    if (result.isErr()) {
      return err({ code: result.error.code, message: result.error.message })
    }
    return ok({
      date: parsed.value.date,
      meal_type: parsed.value.meal_type,
    })
  },
})
