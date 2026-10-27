import { z } from 'zod'

import { MEAL_TYPES } from '#domain/meal-log/types'
import { jstDateSchema } from '#lib/jst-date'

const nutritionMap = z.record(z.string(), z.number())

const nutritionVersionSnapshot = z.object({
  id: z.uuid(),
  version_no: z.number().int(),
  nutrition: nutritionMap,
})

export const reassignMealLogNutritionInput = z.object({
  meal_log_ids: z
    .array(z.string().min(1))
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'meal_log_ids must be unique',
    }),
  to_nutrition_version_id: z.uuid(),
  reason: z.string().trim().min(1),
  dry_run: z.boolean().optional().default(true),
  expected_from_versions: z
    .array(
      z.object({
        meal_log_id: z.string().min(1),
        nutrition_version_id: z.uuid().nullable(),
      }),
    )
    .optional(),
})

export const reassignMealLogNutritionStructuredOutput = z.object({
  dry_run: z.boolean(),
  reason: z.string(),
  meal_logs: z.array(
    z.object({
      meal_log_id: z.string(),
      food_master_id: z.string(),
      eaten_date: jstDateSchema,
      meal_type: z.enum(MEAL_TYPES),
      quantity: z.number(),
      before_nutrition_version: nutritionVersionSnapshot.nullable(),
      after_nutrition_version: nutritionVersionSnapshot,
    }),
  ),
  affected_day_totals: z.array(
    z.object({
      date: jstDateSchema,
      totals_before: nutritionMap,
      totals_after: nutritionMap,
    }),
  ),
})
