import { err, ok, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { ApiResponseShapeError } from '#api/errors'
import { ApiRequestError } from '#api/errors'
import { fetchJson, parseJsonResponse } from '#api/fetch-json'
import { BoundaryError } from '#errors'

const foodSourceSchema = z.enum([
  'web_search',
  'composition_table_estimate',
  'user_input',
])
export type FoodSource = z.infer<typeof foodSourceSchema>

export const SOURCE_LABELS: Record<FoodSource, string> = {
  web_search: 'Web検索',
  composition_table_estimate: '成分表推定',
  user_input: '手入力',
}

const foodMatchReasonSchema = z.enum([
  'history_recent',
  'history_frequent',
  'fuzzy_name',
  'composition_table',
])

const mealTypeSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack'])
export type MealType = z.infer<typeof mealTypeSchema>

const foodListItemSchema = z.object({
  foodMasterId: z.string().nullable(),
  compositionCode: z.string().nullable(),
  name: z.string(),
  isEstimated: z.boolean(),
  reason: foodMatchReasonSchema,
  source: foodSourceSchema.nullable(),
  energyKcalPer100g: z.number().nullable(),
})

export type FoodListItem = z.infer<typeof foodListItemSchema>

const searchResponseSchema = z.object({
  items: z.array(foodListItemSchema),
})

const suggestionsResponseSchema = z.object({
  recent: z.array(foodListItemSchema),
  frequent: z.array(foodListItemSchema),
})

export interface FoodSuggestions {
  readonly recent: ReadonlyArray<FoodListItem>
  readonly frequent: ReadonlyArray<FoodListItem>
}

const isoDateTime = z.string().transform((s, ctx) => {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) {
    ctx.addIssue({ code: 'custom', message: `not a valid timestamp: ${s}` })
    return z.NEVER
  }
  return d
})

const foodEatHistoryEntrySchema = z.object({
  id: z.string(),
  eatenAt: isoDateTime,
  mealType: mealTypeSchema,
  quantity: z.number(),
  unit: z.string(),
})

const foodDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  isEstimated: z.boolean(),
  source: foodSourceSchema,
  sourceUrl: z.string().nullable(),
  aliases: z.array(z.string()),
  nutritionPer100g: z.record(z.string(), z.number()),
  totalEatenCount: z.number(),
  history: z.array(foodEatHistoryEntrySchema),
})

export type FoodDetail = z.infer<typeof foodDetailSchema>

export class FoodNotFoundError extends BoundaryError {}

export const fetchFoodSearch = (
  query: string,
  limit: number,
): ResultAsync<
  ReadonlyArray<FoodListItem>,
  ApiRequestError | ApiResponseShapeError
> =>
  fetchJson(
    `/api/foods/search?${new URLSearchParams({ q: query, limit: String(limit) }).toString()}`,
    searchResponseSchema,
  ).map((body) => body.items)

export const fetchFoodSuggestions = (
  limit: number,
): ResultAsync<FoodSuggestions, ApiRequestError | ApiResponseShapeError> =>
  fetchJson(
    `/api/foods/suggestions?${new URLSearchParams({ limit: String(limit) }).toString()}`,
    suggestionsResponseSchema,
  )

export const fetchFoodDetail = (
  id: string,
): ResultAsync<
  FoodDetail,
  ApiRequestError | ApiResponseShapeError | FoodNotFoundError
> => {
  const url = `/api/foods/${encodeURIComponent(id)}`
  return ResultAsync.fromPromise(
    fetch(url),
    (caughtErr) => new ApiRequestError(`request to ${url} failed`, caughtErr),
  )
    .andThen((res) => {
      if (res.status === 404) {
        return err(new FoodNotFoundError(`food not found: ${id}`, res.status))
      }
      if (!res.ok) {
        return err(
          new ApiRequestError(
            `request to ${url} failed with status ${String(res.status)}`,
            res.status,
          ),
        )
      }
      return ok(res)
    })
    .andThen((res) => parseJsonResponse(res, url, foodDetailSchema))
}
