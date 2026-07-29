import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import { MEAL_TYPES, type MealType } from '#api/day-detail'
import { ApiRequestError } from '#api/errors'
import { requestJson } from '#api/request'

const mealLogResultSchema = z.object({
  id: z.string(),
  foodMasterId: z.string(),
  eatenAt: z.iso.datetime(),
  mealType: z.enum(MEAL_TYPES),
  quantity: z.number(),
  unit: z.string(),
  amountGrams: z.number(),
  note: z.string().nullable(),
  nutrition: z.record(z.string(), z.number()),
  isEstimated: z.boolean(),
  createdAt: z.iso.datetime(),
})

export type MealLogResult = z.infer<typeof mealLogResultSchema>

export interface RecordMealLogInput {
  readonly foodMasterId: string
  readonly eatenAt: string
  readonly mealType?: MealType
  readonly quantity: number
  readonly unit: string
  readonly note?: string
}

export interface UpdateMealLogInput {
  readonly foodMasterId?: string
  readonly eatenAt?: string
  readonly mealType?: MealType
  readonly quantity?: number
  readonly unit?: string
  readonly note?: string
}

export const postMealLog = (
  input: RecordMealLogInput,
): ResultAsync<MealLogResult, ApiRequestError> =>
  requestJson('/api/meal-logs', mealLogResultSchema, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })

export const patchMealLog = (
  id: string,
  input: UpdateMealLogInput,
): ResultAsync<MealLogResult, ApiRequestError> =>
  requestJson(`/api/meal-logs/${encodeURIComponent(id)}`, mealLogResultSchema, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })

// requestJson always parses the body as JSON, but a successful DELETE
// returns 204 with no body.
export const deleteMealLog = (
  id: string,
): ResultAsync<void, ApiRequestError> => {
  const path = `/api/meal-logs/${encodeURIComponent(id)}`
  return ResultAsync.fromPromise(
    fetch(path, { method: 'DELETE' }),
    (cause) => new ApiRequestError(`request to ${path} failed`, cause),
  ).andThen((res) => {
    if (!res.ok) {
      return errAsync(
        new ApiRequestError(
          `${path} responded with ${String(res.status)}`,
          undefined,
        ),
      )
    }
    return okAsync(undefined)
  })
}
