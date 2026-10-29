import type { ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { ApiRequestError } from '#api/errors'
import { foodSourceSchema } from '#api/foods'
import { nutritionStatusSchema } from '#api/nutrition-status'
import { requestJson } from '#api/request'

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const
export type MealType = (typeof MEAL_TYPES)[number]

const nutritionVersionSchema = z.object({
  versionNo: z.number().int().positive(),
  changeKind: z.enum(['initial', 'product_update', 'correction']),
  source: foodSourceSchema,
  isEstimated: z.boolean(),
  checkedOn: z.iso.date().nullable(),
  effectiveFrom: z.iso.date().nullable(),
})

export type NutritionVersion = z.infer<typeof nutritionVersionSchema>

const nutritionVersionOriginSchema = z.enum([
  'recorded',
  'migrated',
  'filled',
  'reassigned',
])

export type NutritionVersionOrigin = z.infer<
  typeof nutritionVersionOriginSchema
>

const dayDetailEntrySchema = z.object({
  id: z.string(),
  foodMasterId: z.string(),
  foodName: z.string(),
  eatenDate: z.string(),
  mealType: z.enum(MEAL_TYPES),
  quantity: z.number(),
  kcal: z.number().nullable(),
  isEstimated: z.boolean(),
  nutritionStatus: nutritionStatusSchema,
  nutritionVersion: nutritionVersionSchema.nullable(),
  nutritionVersionOrigin: nutritionVersionOriginSchema,
  nutritionVersionDifferences: z.array(nutritionVersionSchema),
})

export type DayDetailEntry = z.infer<typeof dayDetailEntrySchema>

const dayDetailSchema = z.object({
  date: z.string(),
  totals: z.record(z.string(), z.number()),
  incompleteNutrients: z.array(z.string()),
  hasEstimatedValues: z.boolean(),
  hasUnknownValues: z.boolean(),
  entries: z.array(dayDetailEntrySchema),
  skippedMealTypes: z.array(z.enum(MEAL_TYPES)),
})

export type DayDetail = z.infer<typeof dayDetailSchema>

export const fetchDayDetail = (
  date: string,
): ResultAsync<DayDetail, ApiRequestError> =>
  requestJson(`/api/days/${date}`, dayDetailSchema)
