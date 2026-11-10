import { z } from 'zod'

import { MEAL_TYPES } from '#domain/meal-log/types'
import { jstDateSchema } from '#lib/jst-date'

export const saveMealPlanInput = z.object({
  date: jstDateSchema.describe('予定日 (JST, YYYY-MM-DD)'),
  meal_type: z.enum(MEAL_TYPES),
  items: z
    .array(
      z.object({
        food_master_id: z.string().min(1),
        food_name: z.string().trim().min(1),
        quantity: z.number(),
      }),
    )
    .min(1),
  reason: z.string().optional(),
})

export const listMealPlansInput = z.object({
  period_from: jstDateSchema.describe('期間の開始日 (JST, 含む)'),
  period_to: jstDateSchema.describe('期間の終了日 (JST, 含まない)'),
})

export const cancelMealPlanInput = z.object({
  meal_plan_id: z.uuid(),
})

const mealPlanOutput = z.object({
  meal_plan_id: z.uuid(),
  date: jstDateSchema,
  meal_type: z.enum(MEAL_TYPES),
  items: z.array(
    z.object({
      food_master_id: z.string(),
      food_name: z.string(),
      quantity: z.number(),
    }),
  ),
  reason: z.string().nullable(),
  status: z.enum(['planned', 'eaten', 'cancelled']),
})

const mealPlanErrorOutput = z.object({
  code: z.string(),
  message: z.string(),
})

export const saveMealPlanStructuredOutput = mealPlanOutput.partial().extend({
  error: mealPlanErrorOutput.optional(),
})

export const listMealPlansStructuredOutput = z.object({
  meal_plans: z.array(mealPlanOutput).optional(),
  error: mealPlanErrorOutput.optional(),
})

export const cancelMealPlanStructuredOutput = mealPlanOutput.partial().extend({
  error: mealPlanErrorOutput.optional(),
})
