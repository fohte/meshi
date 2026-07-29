import type { UseQueryResult } from '@tanstack/react-query'
import { z } from 'zod'

import type { ApiRequestError } from '#api/fetch-json'
import { fetchJson } from '#api/fetch-json'
import { useResultQuery } from '#api/use-result-query'

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const
export type MealType = (typeof MEAL_TYPES)[number]

const dayDetailEntrySchema = z.object({
  id: z.string(),
  foodMasterId: z.string(),
  foodName: z.string(),
  eatenAt: z.iso.datetime(),
  mealType: z.enum(MEAL_TYPES),
  quantity: z.number(),
  unit: z.string(),
  note: z.string().nullable(),
  kcal: z.number(),
  isEstimated: z.boolean(),
})

export type DayDetailEntry = z.infer<typeof dayDetailEntrySchema>

const dayDetailSchema = z.object({
  date: z.string(),
  totals: z.record(z.string(), z.number()),
  hasEstimatedValues: z.boolean(),
  entries: z.array(dayDetailEntrySchema),
})

export type DayDetail = z.infer<typeof dayDetailSchema>

export const useDayDetail = (
  date: string,
): UseQueryResult<DayDetail, ApiRequestError> =>
  useResultQuery(['day-detail', date], () =>
    fetchJson(`/api/days/${date}`, dayDetailSchema),
  )
