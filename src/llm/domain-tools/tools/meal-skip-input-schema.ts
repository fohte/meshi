import { z } from 'zod'

import { MEAL_TYPES } from '#domain/meal-log/types'
import { jstDateSchema } from '#lib/jst-date'

export const mealSkipInputSchema = z.object({
  date: jstDateSchema,
  meal_type: z.enum(MEAL_TYPES),
})
