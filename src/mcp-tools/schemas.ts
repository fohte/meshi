import { z } from 'zod'

import { SUPPORTED_IMAGE_MIME_TYPES } from '@/adapters/image/image-interpreter'

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
      'max_turns_exceeded',
      'divergence_detected',
      'interpretation_failed',
      'item_conversation_failed',
    ]),
    message: z.string(),
  })
  .nullable()

export const mealRecordStructuredOutput = {
  recorded: z.array(recordedMealOutput),
  candidates: z.array(foodCandidateOutput),
  has_estimated_values: z.boolean(),
  error: orchestratorErrorOutput,
}

export const mealHistoryStructuredOutput = {
  aggregate: z
    .object({
      totals: nutritionMap,
      per_day: z.array(
        z.object({
          date: z.string(),
          totals: nutritionMap,
        }),
      ),
      entries: z.array(
        z.object({
          meal_log_id: z.string(),
          food_master_id: z.string(),
          eaten_at_iso: z.string(),
          quantity: z.number(),
          unit: z.string(),
          note: z.string().nullable(),
        }),
      ),
      has_estimated_values: z.boolean(),
    })
    .nullable(),
  has_estimated_values: z.boolean(),
  error: orchestratorErrorOutput,
}

export const recommendStructuredOutput = {
  error: orchestratorErrorOutput,
}

export const profileStructuredOutput = {
  likes: z.array(z.string()),
  dislikes: z.array(z.string()),
  allergies: z.array(z.string()),
  constraints: z.array(z.string()),
  daily_targets: nutritionMap.nullable(),
}

export const recordFromTextInput = {
  text: z.string().min(1).describe('利用者の自然言語発話'),
  occurred_at: isoDatetime
    .optional()
    .describe('発話時刻 (未指定なら meshi が現在時刻を使う)'),
  timezone: z
    .string()
    .min(1)
    .optional()
    .describe('IANA timezone (例: Asia/Tokyo)'),
}

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

export const recordFromImageInput = {
  image: imageContentInput,
  hint_text: z
    .string()
    .min(1)
    .optional()
    .describe('画像と一緒に渡される補助発話 (任意)'),
  occurred_at: isoDatetime.optional(),
  timezone: z.string().min(1).optional(),
}

export const queryMealsInput = {
  query_text: z
    .string()
    .min(1)
    .describe('自然言語クエリ (例: 今週のタンパク質)'),
  period_from_iso: isoDatetime.optional(),
  period_to_iso: isoDatetime.optional(),
  timezone: z.string().min(1).optional(),
}

export const recommendMealInput = {
  additional_constraints: z
    .string()
    .min(1)
    .optional()
    .describe('追加条件 (例: 軽め、外食可)'),
  timezone: z.string().min(1).optional(),
}

export const updateProfileInput = {
  likes: z.array(z.string().min(1)).optional(),
  dislikes: z.array(z.string().min(1)).optional(),
  allergies: z.array(z.string().min(1)).optional(),
  constraints: z.array(z.string().min(1)).optional(),
  // null clears any previously stored daily_targets; omit to keep them.
  daily_targets: nutritionMap.nullable().optional(),
}
