import type { ResultAsync } from 'neverthrow'
import { z } from 'zod'

import { MEAL_TYPES } from '#api/day-detail'
import type { ApiRequestError } from '#api/errors'
import { requestJson } from '#api/request'

const mealHistoryEntrySchema = z.object({
  id: z.string(),
  foodMasterId: z.string(),
  foodName: z.string(),
  eatenDate: z.string(),
  mealType: z.enum(MEAL_TYPES),
  quantity: z.number(),
  unit: z.string(),
})

export type MealHistoryEntry = z.infer<typeof mealHistoryEntrySchema>

const mealHistoryDayTotalsSchema = z.object({
  date: z.string(),
  totals: z.record(z.string(), z.number()),
})

export type MealHistoryDayTotals = z.infer<typeof mealHistoryDayTotalsSchema>

const mealHistorySchema = z.object({
  totals: z.record(z.string(), z.number()),
  perDay: z.array(mealHistoryDayTotalsSchema),
  entries: z.array(mealHistoryEntrySchema),
  hasEstimatedValues: z.boolean(),
})

export type MealHistory = z.infer<typeof mealHistorySchema>

// from is inclusive, to is exclusive (matches the backend's half-open
// [from, to) range semantics).
export const fetchMealHistory = (
  from: string,
  to: string,
): ResultAsync<MealHistory, ApiRequestError> =>
  requestJson(
    `/api/meal-history?${new URLSearchParams({ from, to }).toString()}`,
    mealHistorySchema,
  )
