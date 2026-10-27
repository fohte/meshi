import { z } from 'zod'

import { foodSourceEnum } from '#db/schema'

const nutritionInput = z
  .object({ energy_kcal: z.number().nonnegative() })
  .catchall(z.number().nonnegative())

const versionInputBase = z.object({
  food_master_id: z.string().trim().min(1),
  nutrition: nutritionInput,
  source: z.enum(foodSourceEnum.enumValues),
  is_estimated: z.boolean(),
  source_url: z
    .url()
    .refine((url) => !/[\r\n]/.test(url), {
      message: 'source_url must not contain control characters',
    })
    .optional(),
  source_composition_code: z.string().trim().min(1).optional(),
  serving_basis: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .optional()
    .describe(
      '栄養値の基準量。訂正時に省略すると訂正元の値を引き継ぐ。null は不明を表す。',
    ),
  net_content: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .optional()
    .describe(
      '内容量。訂正時に省略すると訂正元の値を引き継ぐ。null は不明を表す。',
    ),
  effective_from: z.iso
    .date()
    .nullable()
    .optional()
    .describe(
      '商品の栄養情報が実際に適用され始めた日。確認日から推定せず、不明なら null を指定する。訂正時に省略すると訂正元の値を引き継ぐ。',
    ),
})

export const addFoodNutritionVersionInput = z.discriminatedUnion(
  'change_kind',
  [
    versionInputBase
      .extend({
        change_kind: z.literal('product_update'),
        checked_on: z.iso.date().describe('栄養情報を確認した日'),
      })
      .strict(),
    versionInputBase
      .extend({
        change_kind: z.literal('correction'),
        corrects_version_id: z.uuid(),
        reason: z.string().trim().min(1),
        checked_on: z.iso.date().optional().describe('栄養情報を確認した日'),
      })
      .strict(),
  ],
)

const nutritionVersionOutput = z.object({
  nutrition_version_id: z.string(),
  food_master_id: z.string(),
  version_no: z.number().int().positive(),
  change_kind: z.enum(['initial', 'product_update', 'correction']),
  corrects_version_id: z.string().nullable(),
  is_current: z.boolean(),
  serving_basis: z.string().nullable(),
  net_content: z.string().nullable(),
  nutrition: z.record(z.string(), z.number()),
  source: z.enum(foodSourceEnum.enumValues),
  source_url: z.string().nullable(),
  source_composition_code: z.string().nullable(),
  is_estimated: z.boolean(),
  checked_on: z.iso.date().nullable().describe('確認日。不明の場合は null'),
  effective_from: z.iso
    .date()
    .nullable()
    .describe('適用開始日。不明の場合は null とし、確認日から推定しない。'),
  reason: z.string().nullable(),
  meal_log_count: z.number().int().nonnegative(),
})

export const addFoodNutritionVersionStructuredOutput = nutritionVersionOutput

export const listFoodNutritionVersionsInput = z
  .object({ food_master_id: z.string().trim().min(1) })
  .strict()

export const listFoodNutritionVersionsStructuredOutput = z.object({
  food_master_id: z.string(),
  nutrition_versions: z.array(nutritionVersionOutput),
})
