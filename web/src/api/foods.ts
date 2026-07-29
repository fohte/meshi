import { errAsync, ok, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import { ApiRequestError } from '#api/errors'
import { requestJson } from '#api/request'
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
  // The resolved gram amount this entry's quantity+unit was converted to at
  // record time — the basis for this entry's kcal, not `quantity` (which is
  // for display only; see src/db/schema.ts's meal_logs.amount_grams).
  amountGrams: z.number(),
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
): ResultAsync<ReadonlyArray<FoodListItem>, ApiRequestError> =>
  requestJson(
    `/api/foods/search?${new URLSearchParams({ q: query, limit: String(limit) }).toString()}`,
    searchResponseSchema,
  ).map((body) => body.items)

export const fetchFoodSuggestions = (
  limit: number,
): ResultAsync<FoodSuggestions, ApiRequestError> =>
  requestJson(
    `/api/foods/suggestions?${new URLSearchParams({ limit: String(limit) }).toString()}`,
    suggestionsResponseSchema,
  )

// requestJson can't be reused wholesale here: a 404 is a normal, meaningful
// outcome (the food doesn't exist) rather than the generic ApiRequestError
// requestJson maps every non-2xx status to.
export const fetchFoodDetail = (
  id: string,
): ResultAsync<FoodDetail, ApiRequestError | FoodNotFoundError> => {
  const path = `/api/foods/${encodeURIComponent(id)}`
  return ResultAsync.fromPromise(
    fetch(path),
    (cause) => new ApiRequestError(`request to ${path} failed`, cause),
  )
    .andThen((res) => {
      if (res.status === 404) {
        return errAsync(
          new FoodNotFoundError(`food not found: ${id}`, res.status),
        )
      }
      if (!res.ok) {
        return errAsync(
          new ApiRequestError(
            `${path} responded with ${String(res.status)}`,
            undefined,
          ),
        )
      }
      return ok(res)
    })
    .andThen((res) =>
      ResultAsync.fromPromise(
        res.json() as Promise<unknown>,
        (cause) =>
          new ApiRequestError(
            `failed to parse ${path} response as JSON`,
            cause,
          ),
      ),
    )
    .andThen((body) => {
      const parsed = foodDetailSchema.safeParse(body)
      if (!parsed.success) {
        return errAsync(
          new ApiRequestError(
            `${path} response did not match the expected schema`,
            parsed.error,
          ),
        )
      }
      return ok(parsed.data)
    })
}
