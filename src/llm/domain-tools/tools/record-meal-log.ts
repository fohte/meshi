import { z } from 'zod'

import { DomainError } from '@/domain/meal-log/errors'
import type { MealLogService } from '@/domain/meal-log/meal-log-service'
import { toInternalToolError } from '@/llm/domain-tools/internal-error'
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
    'Persist a meal log entry for a known food_master. Returns the assigned meal_log_id and the scaled nutrition for the recorded quantity.',
  inputSchema: z.toJSONSchema(inputSchema, { io: 'input' }),
  async execute(
    input: unknown,
  ): Promise<Result<RecordMealLogOutput, ToolError>> {
    const parsed = parseToolInput(inputSchema, input)
    if (!parsed.ok) return parsed
    try {
      const result = await service.record({
        foodMasterId: parsed.value.food_master_id,
        eatenAt: new Date(parsed.value.eaten_at_iso),
        quantity: parsed.value.quantity,
        unit: parsed.value.unit,
        ...(parsed.value.note === undefined ? {} : { note: parsed.value.note }),
      })
      return ok({
        meal_log_id: result.id,
        nutrition: result.nutrition,
        is_estimated: result.isEstimated,
      })
    } catch (e) {
      return err(toToolError(e))
    }
  },
})

const toToolError = (e: unknown): ToolError =>
  e instanceof DomainError
    ? { code: e.code, message: e.message }
    : toInternalToolError(e)
