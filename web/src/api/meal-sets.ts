import { okAsync, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import { ApiRequestError } from '#api/errors'
import { requestJson } from '#api/request'
import { parseApiError } from '#api/request-error'

const mealSetItemSchema = z.object({
  foodMasterId: z.string(),
  foodName: z.string(),
  quantity: z.number(),
  energyKcalPerUnit: z.number().nullable(),
})

const mealSetSchema = z.object({
  id: z.string(),
  name: z.string(),
  items: z.array(mealSetItemSchema),
  createdAt: z.iso.datetime(),
})

const mealSetListSchema = z.array(mealSetSchema)
export type MealSet = z.infer<typeof mealSetSchema>

export interface SaveMealSetInput {
  readonly name: string
  readonly items: ReadonlyArray<{
    readonly foodMasterId: string
    readonly quantity: number
  }>
}

const requestMealSetJson = <Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  init?: RequestInit,
): ResultAsync<z.infer<Schema>, ApiRequestError> =>
  requestJson(path, schema, init, (response) => parseApiError(path, response))

const requestMealSetDelete = (
  path: string,
): ResultAsync<void, ApiRequestError> =>
  ResultAsync.fromPromise(
    fetch(path, { method: 'DELETE' }),
    (cause) => new ApiRequestError(`request to ${path} failed`, cause),
  ).andThen((response) => {
    if (!response.ok) {
      return parseApiError(path, response)
    }
    return okAsync(undefined)
  })

export const fetchMealSets = (): ResultAsync<
  ReadonlyArray<MealSet>,
  ApiRequestError
> => requestMealSetJson('/api/meal-sets', mealSetListSchema)

export const postMealSet = (
  input: SaveMealSetInput,
): ResultAsync<MealSet, ApiRequestError> =>
  requestMealSetJson('/api/meal-sets', mealSetSchema, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })

export const patchMealSet = (
  id: string,
  input: SaveMealSetInput,
): ResultAsync<MealSet, ApiRequestError> =>
  requestMealSetJson(
    `/api/meal-sets/${encodeURIComponent(id)}`,
    mealSetSchema,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  )

export const deleteMealSet = (id: string): ResultAsync<void, ApiRequestError> =>
  requestMealSetDelete(`/api/meal-sets/${encodeURIComponent(id)}`)
