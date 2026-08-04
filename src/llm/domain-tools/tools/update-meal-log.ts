import { z } from 'zod'

import type { MealLogService } from '#domain/meal-log/meal-log-service'
import { MEAL_TYPES } from '#domain/meal-log/types'
import { parseToolInput } from '#llm/domain-tools/parse'
import { toToolError } from '#llm/domain-tools/to-tool-error'
import {
  type DomainTool,
  err,
  ok,
  type Result,
  type ToolError,
} from '#llm/domain-tools/types'

const inputSchema = z
  .object({
    meal_log_id: z.string().min(1),
    food_master_id: z.string().min(1).optional(),
    eaten_at_iso: z.iso.datetime({ offset: true }).optional(),
    meal_type: z.enum(MEAL_TYPES).optional(),
    quantity: z.number().positive().optional(),
    unit: z.string().min(1).optional(),
  })
  .refine(
    (v) =>
      v.food_master_id !== undefined ||
      v.eaten_at_iso !== undefined ||
      v.meal_type !== undefined ||
      v.quantity !== undefined ||
      v.unit !== undefined,
    { message: 'at least one field to update must be provided' },
  )

export interface UpdateMealLogOutput {
  readonly meal_log_id: string
  readonly nutrition: Readonly<Record<string, number>>
  readonly is_estimated: boolean
}

export const createUpdateMealLogTool = (
  service: MealLogService,
): DomainTool => ({
  name: 'update_meal_log',
  description:
    'Patch fields on an already-recorded meal_log identified by meal_log_id (from query_meal_history entries, or a prior record_meal_log/update_meal_log result). Omitted fields are left unchanged. Use this to fix a mistake (wrong quantity, unit, food_master_id, eaten_at, or meal_type) instead of calling record_meal_log again, which would create a duplicate entry. Re-validates the same invariants as record_meal_log: eaten_at_iso must not be in the future, quantity must be positive, and a changed food_master_id must exist. Returns the meal_log_id and the recomputed nutrition for the corrected entry.',
  inputSchema: z.toJSONSchema(inputSchema, { io: 'input' }),
  async execute(
    input: unknown,
  ): Promise<Result<UpdateMealLogOutput, ToolError>> {
    const parsed = parseToolInput(inputSchema, input)
    if (parsed.isErr()) return err(parsed.error)
    const result = await service.update({
      id: parsed.value.meal_log_id,
      ...(parsed.value.food_master_id === undefined
        ? {}
        : { foodMasterId: parsed.value.food_master_id }),
      ...(parsed.value.eaten_at_iso === undefined
        ? {}
        : { eatenAt: new Date(parsed.value.eaten_at_iso) }),
      ...(parsed.value.meal_type === undefined
        ? {}
        : { mealType: parsed.value.meal_type }),
      ...(parsed.value.quantity === undefined
        ? {}
        : { quantity: parsed.value.quantity }),
      ...(parsed.value.unit === undefined ? {} : { unit: parsed.value.unit }),
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
