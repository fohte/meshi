import { z } from 'zod'

import { MEAL_TYPES } from '#domain/meal-log/types'
import { jstDateSchema } from '#lib/jst-date'

export const updateMealLogInputSchema = z
  .object({
    meal_log_id: z.string().min(1),
    food_master_id: z.string().min(1).optional(),
    date: jstDateSchema.optional(),
    meal_type: z.enum(MEAL_TYPES).optional(),
    quantity: z.number().positive().optional(),
  })
  .refine(
    (value) =>
      value.food_master_id !== undefined ||
      value.date !== undefined ||
      value.meal_type !== undefined ||
      value.quantity !== undefined,
    { message: 'at least one field to update must be provided' },
  )
