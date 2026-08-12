import type { ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { ApiRequestError } from '#api/errors'
import { requestJson } from '#api/request'

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const
export type MealType = (typeof MEAL_TYPES)[number]

const dayDetailEntrySchema = z.object({
  id: z.string(),
  foodMasterId: z.string(),
  foodName: z.string(),
  eatenDate: z.string(),
  mealType: z.enum(MEAL_TYPES),
  quantity: z.number(),
  kcal: z.number(),
  isEstimated: z.boolean(),
})

export type DayDetailEntry = z.infer<typeof dayDetailEntrySchema>

const dayDetailSchema = z.object({
  date: z.string(),
  totals: z.record(z.string(), z.number()),
  hasEstimatedValues: z.boolean(),
  entries: z.array(dayDetailEntrySchema),
  skippedMealTypes: z.array(z.enum(MEAL_TYPES)),
})

export type DayDetail = z.infer<typeof dayDetailSchema>

export const fetchDayDetail = (
  date: string,
): ResultAsync<DayDetail, ApiRequestError> =>
  requestJson(`/api/days/${date}`, dayDetailSchema)
