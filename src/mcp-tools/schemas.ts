import { z } from 'zod'

import { hasDuplicateAfterTrim } from '#domain/food-master/validation'
import { MEAL_TYPES } from '#domain/meal-log/types'
import { jstDateSchema } from '#lib/jst-date'

// z.number() rejects NaN and Infinity by default in zod v4, so it is safe to
// reuse this schema on the MCP input boundary (update_profile.daily_targets).
const nutritionMap = z.record(z.string().min(1), z.number())

export const mealHistoryStructuredOutput = z.object({
  totals: nutritionMap,
  per_day: z.array(
    z.object({
      date: jstDateSchema,
      totals: nutritionMap,
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
      nutrition_status: z.enum(['confirmed', 'estimated', 'unknown']),
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

export const profileStructuredOutput = z.object({
  likes: z.array(z.string()),
  dislikes: z.array(z.string()),
  allergies: z.array(z.string()),
  constraints: z.array(z.string()),
  daily_targets: nutritionMap.nullable(),
})

export const recommendationContextStructuredOutput = z.object({
  profile: profileStructuredOutput,
  history: mealHistoryStructuredOutput,
})

export const queryMealsInput = z.object({
  period_from: jstDateSchema.describe('期間の開始日 (JST、含む。YYYY-MM-DD)'),
  period_to: jstDateSchema.describe('期間の終了日 (JST、含まない。YYYY-MM-DD)'),
})

export const deleteMealLogInput = z.object({
  meal_log_ids: z
    .array(z.string().min(1))
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'meal_log_ids must not contain duplicates',
    }),
})

const mealLogMutationOutput = z.object({
  meal_log_id: z.string(),
  food_master_id: z.string(),
  food_name: z.string(),
  eaten_date: jstDateSchema,
  meal_type: z.enum(MEAL_TYPES),
  quantity: z.number(),
})

export const deleteMealLogStructuredOutput = z.object({
  deleted: z.array(mealLogMutationOutput),
})

const mealSkipIdentity = z.object({
  date: jstDateSchema,
  meal_type: z.enum(MEAL_TYPES),
})

const mealSkipInput = z.object({
  date: mealSkipIdentity.shape.date.describe('対象の日付 (JST、YYYY-MM-DD)'),
  meal_type: mealSkipIdentity.shape.meal_type.describe('対象の食事区分'),
})

export const recordMealSkipInput = mealSkipInput

export const cancelMealSkipInput = mealSkipInput

export const recordMealSkipStructuredOutput = mealSkipIdentity.extend({
  meal_skip_id: z.string(),
})

export const cancelMealSkipStructuredOutput = mealSkipIdentity

export const updateMealLogStructuredOutput = mealLogMutationOutput.extend({
  nutrition: nutritionMap,
  is_estimated: z.boolean(),
})

export const updateProfileInput = z.object({
  likes: z.array(z.string().min(1)).optional(),
  dislikes: z.array(z.string().min(1)).optional(),
  allergies: z.array(z.string().min(1)).optional(),
  constraints: z.array(z.string().min(1)).optional(),
  // null clears any previously stored daily_targets; omit to keep them.
  daily_targets: nutritionMap.nullable().optional(),
})

export const searchFoodsInput = z.object({
  queries: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(10)
    .describe('食品名や別名の候補 (1〜10 個)'),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('最大件数 (省略時 10 件)'),
  origin: z
    .enum(['retail', 'homemade'])
    .optional()
    .describe('retail は買ったものや外食、homemade は自炊'),
})

export const searchFoodsStructuredOutput = z.object({
  foods: z.array(
    z.object({
      food_master_id: z.string().nullable(),
      composition_code: z.string().nullable(),
      name: z.string(),
      energy_kcal: z
        .number()
        .nullable()
        .describe(
          'food_master は 1 つ分、食品成分表候補は 100g あたり。該当する kcal がなければ null',
        ),
      is_estimated: z.boolean(),
      nutrition_status: z.enum(['confirmed', 'estimated', 'unknown']),
    }),
  ),
})

export const registerFoodFromCompositionInput = z
  .object({
    composition_code: z
      .string()
      .trim()
      .min(1)
      .describe('search_foods が自炊向けに返した食品成分表候補のコード'),
    name: z.string().trim().min(1).optional().describe('登録する食品名'),
    aliases: z
      .array(z.string().trim().min(1))
      .optional()
      .describe('登録する別名'),
  })
  .strict()
  .refine((value) => !hasDuplicateAfterTrim(value.aliases ?? []), {
    message: 'aliases must not contain duplicates within the same input',
    path: ['aliases'],
  })

export const registerFoodFromCompositionStructuredOutput = z.object({
  food_master_id: z.string(),
  name: z.string(),
})

export const mergeFoodMasterInput = z.object({
  survivor_food_master_id: z.string().min(1),
  loser_food_master_id: z.string().min(1),
  dry_run: z.boolean().optional().default(true),
})

export const mergeFoodMasterStructuredOutput = z.object({
  survivor_food_master_id: z.string(),
  loser_food_master_id: z.string(),
  applied: z.boolean(),
  moved_aliases: z.array(z.string()),
  name_moved_as_alias: z.string().nullable(),
  discarded_nutrition: nutritionMap,
  moved_meal_log_count: z.number().int().nonnegative(),
})

const registerFoodNutrition = z
  .object({ energy_kcal: z.number().nonnegative() })
  .catchall(z.number().nonnegative())

export const registerFoodInput = z.object({
  name: z.string().trim().min(1).describe('登録する食品名'),
  aliases: z
    .array(z.string().trim().min(1))
    .optional()
    .describe('食品名の別名'),
  nutrition: registerFoodNutrition.describe(
    '出典が示す 1 つ分の栄養値。energy_kcal は必須',
  ),
  source: z.enum(['web_search', 'user_input']),
  is_estimated: z.boolean().describe('栄養値が推定値かどうか'),
  source_url: z
    .url()
    .refine((url) => !/[\r\n]/.test(url), {
      message: 'source_url must not contain control characters',
    })
    .optional()
    .describe('web_search で参照した公式ページ'),
  confirmed_distinct_from_master_ids: z
    .array(z.string().trim().min(1))
    .optional()
    .describe('別物だと確認した類似食品の food_master_id'),
})

export const similarFoodMasterCandidateOutput = z.object({
  food_master_id: z.string(),
  name: z.string(),
  score: z.number(),
})

export const registerFoodStructuredOutput = z.object({
  food_master_id: z.string().optional(),
  name: z.string().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      candidates: z.array(similarFoodMasterCandidateOutput).optional(),
    })
    .optional(),
})
export const recordMealLogInput = z.object({
  date: jstDateSchema.describe('食事をした日付 (JST, YYYY-MM-DD)'),
  meal_type: z.enum(MEAL_TYPES),
  items: z
    .array(
      z.object({
        food_master_id: z
          .string()
          .min(1)
          .describe('search_foods で確定した ID'),
        food_name: z
          .string()
          .trim()
          .min(1)
          .describe('food_master_id と照合する食品名'),
        quantity: z.number().describe('食品 1 つ分に対する倍率'),
      }),
    )
    .min(1),
})

export const recordMealLogStructuredOutput = z.object({
  recorded: z.array(
    z.object({
      meal_log_id: z.string(),
      food_master_id: z.string(),
      food_name: z.string(),
      quantity: z.number(),
      nutrition: nutritionMap,
      is_estimated: z.boolean(),
      nutrition_status: z.enum(['confirmed', 'estimated', 'unknown']),
    }),
  ),
  error: z
    .object({
      item_index: z
        .number()
        .int()
        .positive()
        .nullable()
        .describe(
          '不正な品目の 1 始まりの位置。日付など品目共通のエラーでは null',
        ),
      code: z.string(),
      message: z.string(),
    })
    .nullable(),
})
