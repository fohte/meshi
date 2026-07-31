import { z } from 'zod'

import { MEAL_TYPES } from '#domain/meal-log/types'
import { isValidJstCalendarDateString } from '#lib/jst-date'

export const mealSkipInputSchema = z.object({
  date: z.string().refine(isValidJstCalendarDateString, {
    message: 'date must be a valid YYYY-MM-DD JST calendar date',
  }),
  meal_type: z.enum(MEAL_TYPES),
})
