import { z } from 'zod'

import { NUTRITION_STATUSES } from '#domain/food-master/types'
import { nutritionVersionSchema } from '#domain/meal-history/nutritionVersionSchema'
import { NUTRITION_VERSION_ORIGINS } from '#domain/meal-history/types'
import { MEAL_TYPES } from '#domain/meal-log/types'
import { jstDateSchema } from '#lib/jst-date'
import { nutritionMap } from '#mcp-tools/nutrition-map-schema'

export const mealHistoryStructuredOutput = z.object({
  totals: nutritionMap,
  incomplete_nutrients: z
    .array(z.string())
    .describe(
      '期間内の食事に値のない食品が 1 件以上ある栄養素コード。値のない行は不明として扱います。',
    ),
  per_day: z.array(
    z.object({
      date: jstDateSchema,
      totals: nutritionMap,
      incomplete_nutrients: z
        .array(z.string())
        .describe(
          'この日の食事に値のない食品が 1 件以上ある栄養素コード。値のない行は不明として扱います。',
        ),
      has_unknown_values: z.boolean(),
    }),
  ),
  entries: z.array(
    z.object({
      meal_log_id: z
        .string()
        .describe('食事記録 ID。後で記録を削除・修正するときに指定する。'),
      food_master_id: z.string(),
      food_name: z.string(),
      eaten_date: jstDateSchema,
      meal_type: z.enum(MEAL_TYPES),
      quantity: z.number(),
      nutrition_status: z.enum(NUTRITION_STATUSES),
      nutrition_version: nutritionVersionSchema
        .nullable()
        .describe('採用バージョン。null はバージョン不明を表します。'),
      nutrition_version_origin: z.enum(NUTRITION_VERSION_ORIGINS),
      nutrition_version_differences: z
        .array(nutritionVersionSchema)
        .describe(
          '採用バージョンと栄養値が異なる同じ食品の別バージョン。差異がなければ空配列です。',
        ),
      recorded_at: z.iso
        .datetime({ offset: true })
        .describe(
          'meal_logs.created_at を UTC の ISO 8601 形式で秒精度にした値',
        ),
    }),
  ),
  has_estimated_values: z.boolean(),
  has_unknown_values: z.boolean(),
})
