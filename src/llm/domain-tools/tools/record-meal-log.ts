import { z } from 'zod'

import type { DomainError } from '@/domain/meal-log/errors'
import type { MealLogService } from '@/domain/meal-log/meal-log-service'
import { MEAL_TYPES } from '@/domain/meal-log/types'
import { parseToolInput } from '@/llm/domain-tools/parse'
import {
  type DomainTool,
  err,
  ok,
  type Result,
  type ToolError,
} from '@/llm/domain-tools/types'

const inputSchema = z.object({
  food_master_id: z.string().min(1),
  eaten_at_iso: z.iso.datetime({ offset: true }),
  meal_type: z.enum(MEAL_TYPES).optional(),
  quantity: z.number().positive(),
  unit: z.string().min(1),
  note: z.string().optional(),
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
    'Persist a meal log entry for a known food_master. Returns the assigned meal_log_id and the scaled nutrition for the recorded quantity. Pass meal_type when the user names it (e.g. breakfast/lunch/dinner/snack); when omitted, it defaults to a time-of-day estimate derived from eaten_at_iso.',
  inputSchema: z.toJSONSchema(inputSchema, { io: 'input' }),
  async execute(
    input: unknown,
  ): Promise<Result<RecordMealLogOutput, ToolError>> {
    const parsed = parseToolInput(inputSchema, input)
    if (parsed.isErr()) return err(parsed.error)
    const result = await service.record({
      foodMasterId: parsed.value.food_master_id,
      eatenAt: new Date(parsed.value.eaten_at_iso),
      quantity: parsed.value.quantity,
      unit: parsed.value.unit,
      ...(parsed.value.meal_type === undefined
        ? {}
        : { mealType: parsed.value.meal_type }),
      ...(parsed.value.note === undefined ? {} : { note: parsed.value.note }),
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

const toToolError = (e: DomainError): ToolError => ({
  code: e.code,
  message: e.message,
})
