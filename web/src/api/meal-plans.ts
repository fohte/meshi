import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import { MEAL_TYPES, type MealType } from '#api/day-detail'
import { ApiRequestError } from '#api/errors'
import { requestJson } from '#api/request'

const mealPlanItemSchema = z.object({
  foodMasterId: z.string(),
  foodName: z.string(),
  quantity: z.number(),
  energyKcalPerUnit: z.number().nullable(),
})

const mealPlanSchema = z.object({
  id: z.string(),
  date: z.iso.date(),
  mealType: z.enum(MEAL_TYPES),
  reason: z.string().nullable(),
  status: z.enum(['planned', 'eaten', 'cancelled']),
  items: z.array(mealPlanItemSchema),
})

export type MealPlan = z.infer<typeof mealPlanSchema>

export interface SaveMealPlanInput {
  readonly reason?: string
  readonly items: ReadonlyArray<{
    readonly foodMasterId: string
    readonly foodName: string
    readonly quantity: number
  }>
}

export const fetchMealPlans = (
  from: string,
  to: string,
): ResultAsync<ReadonlyArray<MealPlan>, ApiRequestError> =>
  requestJson(
    `/api/meal-plans?${new URLSearchParams({ from, to }).toString()}`,
    z.array(mealPlanSchema),
  )

export const putMealPlan = (
  date: string,
  mealType: MealType,
  input: SaveMealPlanInput,
): ResultAsync<MealPlan, ApiRequestError> =>
  requestJson(
    `/api/meal-plans/${encodeURIComponent(date)}/${encodeURIComponent(mealType)}`,
    mealPlanSchema,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  )

export const postMealPlanCancel = (
  id: string,
): ResultAsync<void, ApiRequestError> =>
  ResultAsync.fromPromise(
    fetch(`/api/meal-plans/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
    }),
    (cause) =>
      new ApiRequestError('meal plan cancellation request failed', cause),
  ).andThen((response) => {
    if (!response.ok) {
      return errAsync(
        new ApiRequestError(
          `/api/meal-plans/cancel responded with ${String(response.status)}`,
          undefined,
        ),
      )
    }
    return okAsync(undefined)
  })
