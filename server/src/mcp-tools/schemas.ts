import { z } from 'zod'

import { foodSourceEnum } from '#db/schema'
import { NUTRITION_STATUSES } from '#domain/food-master/types'
import { hasDuplicateAfterTrim } from '#domain/food-master/validation'
import { MEAL_TYPES } from '#domain/meal-log/types'
import { jstDateSchema } from '#lib/jst-date'
import { mealHistoryStructuredOutput } from '#mcp-tools/meal-history-schemas'
import { nutritionMap } from '#mcp-tools/nutrition-map-schema'
import { stockStorageLocationOutput } from '#mcp-tools/stock-status-schemas'

export {
  deliveryStructuredOutput,
  receiveDeliveryInput,
  registerDeliveryInput,
} from '#mcp-tools/delivery-schemas'
export {
  getStockStatusInput,
  getStockStatusStructuredOutput,
} from '#mcp-tools/stock-status-schemas'
export { mealHistoryStructuredOutput }

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
  stock_shortfall: z.number().nonnegative().nullable(),
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

const mealSetItemOutput = z.object({
  food_master_id: z.string(),
  food_name: z.string(),
  quantity: z.number(),
})

const mealSetOutput = z.object({
  meal_set_id: z.string(),
  name: z.string(),
  items: z.array(mealSetItemOutput),
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
      nutrition_status: z.enum(NUTRITION_STATUSES),
      last_eaten_date: jstDateSchema
        .nullable()
        .describe('最後に食べた JST 日付。記録が無い候補と成分表候補は null'),
      last_quantity: z
        .number()
        .nullable()
        .describe(
          '最後の記録の quantity (食品 1 つ分への倍率)。記録が無い候補と成分表候補は null',
        ),
    }),
  ),
  meal_sets: z.array(mealSetOutput),
})

// The service owns semantic validation so callers receive typed meal-set errors.
export const registerMealSetInput = z.object({
  name: z.string().describe('登録するマイセット名'),
  items: z
    .array(
      z.object({
        food_master_id: z.string().describe('セットに含める食品の ID'),
        quantity: z.number().describe('食品 1 つ分への倍率'),
      }),
    )
    .describe('マイセットに含める食品'),
})

export const registerMealSetStructuredOutput = mealSetOutput.partial().extend({
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
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
  moved_nutrition_versions: z.array(
    z.object({
      previous_version_no: z.number().int().positive(),
      version_no: z.number().int().positive(),
    }),
  ),
  moved_meal_log_count: z.number().int().nonnegative(),
})

const registerFoodNutrition = z
  .object({ energy_kcal: z.number().nonnegative() })
  .catchall(z.number().nonnegative())

const mcpFoodSourceSchema = z
  .enum(foodSourceEnum.enumValues)
  .exclude(['composition_table_estimate'])

export const registerFoodInput = z.object({
  name: z.string().trim().min(1).describe('登録する食品名'),
  aliases: z
    .array(z.string().trim().min(1))
    .optional()
    .describe('食品名の別名'),
  nutrition: registerFoodNutrition.describe(
    '食品 1 つ分の栄養値 (出典値または推定値)。energy_kcal は必須',
  ),
  source: mcpFoodSourceSchema,
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

export const fillFoodNutritionInput = z.object({
  food_master_id: z
    .string()
    .trim()
    .min(1)
    .describe('栄養値を補完する食品の ID'),
  nutrition: registerFoodNutrition.describe(
    '食品 1 つ分の栄養値 (出典値または推定値)。energy_kcal は必須',
  ),
  source: mcpFoodSourceSchema,
  is_estimated: z.boolean().describe('栄養値が推定値かどうか'),
  source_url: z
    .url()
    .refine((url) => !/[\r\n]/.test(url), {
      message: 'source_url must not contain control characters',
    })
    .optional()
    .describe('web_search で参照した公式ページ'),
})

export const fillFoodNutritionStructuredOutput = z.object({
  food_master_id: z.string().optional(),
  nutrition_status: z.enum(['confirmed', 'estimated']).optional(),
  nutrition_version_no: z.number().int().positive().optional(),
  assigned_meal_logs: z
    .array(
      z.object({
        meal_log_id: z.string(),
        eaten_date: jstDateSchema,
        meal_type: z.enum(MEAL_TYPES),
        quantity: z.number(),
      }),
    )
    .optional(),
  affected_day_totals: z
    .array(
      z.object({
        date: jstDateSchema,
        totals_before: nutritionMap,
        totals_after: nutritionMap,
      }),
    )
    .optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
})

export const registerFoodWithoutNutritionInput = registerFoodInput.pick({
  name: true,
  aliases: true,
  confirmed_distinct_from_master_ids: true,
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
      stock_shortfall: z.number().nonnegative().nullable(),
      nutrition: nutritionMap,
      is_estimated: z.boolean(),
      nutrition_status: z.enum(NUTRITION_STATUSES),
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

export const setStockItemInput = z
  .object({
    food_master_id: z.string().min(1),
    storage_location_name: z
      .string()
      .trim()
      .min(1)
      .nullable()
      .optional()
      .describe('保存場所名。省略すると維持し、null で解除する'),
    storage_location_capacity: z
      .number()
      .positive()
      .nullable()
      .optional()
      .describe('保存場所の容量。null で容量を解除する'),
    eat_within_days: z
      .number()
      .int()
      .positive()
      .nullable()
      .optional()
      .describe('受領日から食べ切りたい日数。null で解除する'),
  })
  .strict()
  .refine(
    (input) =>
      input.storage_location_capacity === undefined ||
      input.storage_location_name !== null,
    {
      message: 'storage_location_capacity requires a storage location',
      path: ['storage_location_capacity'],
    },
  )

export const setStockItemStructuredOutput = z.object({
  food_master_id: z.string(),
  food_name: z.string(),
  storage_location: stockStorageLocationOutput.nullable(),
  eat_within_days: z.number().int().nullable(),
})

export const countStockInput = z
  .object({
    food_master_id: z.string().min(1),
    quantity: z.number().min(0),
    received_date: z.iso.date().nullable().optional(),
    best_before: z.iso.date().nullable().optional(),
  })
  .strict()

export const countStockStructuredOutput = z.object({
  food_master_id: z.string(),
  previous_quantity: z.number(),
  counted_quantity: z.number(),
  difference: z.number(),
})

export const updateStockLotInput = z
  .object({
    stock_lot_id: z.string().trim().min(1),
    best_before: z.iso.date().nullable().optional(),
    eat_by: z.iso.date().nullable().optional(),
  })
  .strict()
  .refine(
    (input) => input.best_before !== undefined || input.eat_by !== undefined,
    {
      message: 'at least one of best_before or eat_by must be provided',
    },
  )

export const updateStockLotStructuredOutput = z.object({
  stock_lot_id: z.string(),
  best_before: z.iso.date().nullable(),
  eat_by: z.iso.date().nullable(),
})
