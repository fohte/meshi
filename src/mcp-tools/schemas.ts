import { z } from 'zod'

import { SUPPORTED_IMAGE_MIME_TYPES } from '#adapters/image/image-types'
import { MEAL_TYPES } from '#domain/meal-log/types'
import { jstDateSchema } from '#lib/jst-date'

const isoDatetime = z.iso.datetime({ offset: true })
// z.number() rejects NaN and Infinity by default in zod v4, so it is safe to
// reuse this schema on the MCP input boundary (update_profile.daily_targets).
const nutritionMap = z.record(z.string().min(1), z.number())

const recordedMealOutput = z.object({
  meal_log_id: z.string(),
  food_master_id: z.string(),
  nutrition: nutritionMap,
  is_estimated: z.boolean(),
})

const foodCandidateOutput = z.object({
  food_master_id: z.string().nullable(),
  composition_code: z.string().nullable(),
  name: z.string(),
  is_estimated: z.boolean(),
  score: z.number(),
  reason: z.string(),
})

const orchestratorErrorOutput = z
  .object({
    kind: z.enum([
      'deadline_exceeded',
      'max_turns_exceeded',
      'divergence_detected',
      'interpretation_failed',
      'item_conversation_failed',
    ]),
    message: z.string(),
  })
  .nullable()

export const mealRecordStructuredOutput = z.object({
  recorded: z.array(recordedMealOutput),
  candidates: z.array(foodCandidateOutput),
  has_estimated_values: z.boolean(),
  error: orchestratorErrorOutput,
})

export const mealHistoryStructuredOutput = z.object({
  totals: nutritionMap,
  per_day: z.array(
    z.object({
      date: jstDateSchema,
      totals: nutritionMap,
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
      recorded_at: z.iso
        .datetime({ offset: true })
        .describe(
          'meal_logs.created_at を UTC の ISO 8601 形式で秒精度にした値',
        ),
    }),
  ),
  has_estimated_values: z.boolean(),
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

export const recordFromTextInput = z.object({
  text: z.string().min(1).describe('利用者の自然言語発話'),
  occurred_at: isoDatetime
    .optional()
    .describe('発話時刻 (未指定なら meshi が現在時刻を使う)'),
  timezone: z
    .string()
    .min(1)
    .optional()
    .describe('IANA timezone (例: Asia/Tokyo)'),
})

const base64Data = z
  .string()
  .min(1)
  .regex(
    /^[A-Za-z0-9+/]+={0,2}$/,
    'image.data must be raw base64 (no data: URL prefix, no http(s):// URL, no whitespace)',
  )
  .describe('base64 (no data: prefix, no URL)')

const imageContentInput = z
  .object({
    type: z.literal('image'),
    mimeType: z.enum([...SUPPORTED_IMAGE_MIME_TYPES]),
    data: base64Data,
  })
  .describe('MCP image content. 外部 URL は受け取らない。')

export const recordFromImageInput = z.object({
  image: imageContentInput,
  hint_text: z
    .string()
    .min(1)
    .optional()
    .describe('画像と一緒に渡される補助発話 (任意)'),
  occurred_at: isoDatetime.optional(),
  timezone: z.string().min(1).optional(),
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
})

export const searchFoodsStructuredOutput = z.object({
  foods: z.array(
    z.object({
      food_master_id: z.string(),
      name: z.string(),
      energy_kcal: z
        .number()
        .nullable()
        .describe('food_master 1 つ分の kcal。食品の kcal が未登録なら null'),
      is_estimated: z.boolean(),
    }),
  ),
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
