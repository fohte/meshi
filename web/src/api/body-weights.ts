import { okAsync, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import { ApiRequestError } from '#api/errors'
import { requestJson } from '#api/request'
import { parseApiError } from '#api/request-error'

const bodyWeightSchema = z.object({
  id: z.string(),
  date: z.iso.date(),
  measuredAt: z.iso.datetime().nullable(),
  weightKg: z.number(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

const bodyWeightListSchema = z.array(bodyWeightSchema)
export type BodyWeight = z.infer<typeof bodyWeightSchema>

export interface SaveBodyWeightInput {
  readonly date: string
  readonly weightKg: number
  readonly measuredAt?: string
}

export interface UpdateBodyWeightInput {
  readonly date: string
  readonly weightKg: number
  readonly measuredAt: string | null
}

export const BODY_WEIGHTS_QUERY_KEY = ['body-weights']

const requestBodyWeightJson = <Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  init?: RequestInit,
): ResultAsync<z.infer<Schema>, ApiRequestError> =>
  requestJson(path, schema, init, (response) => parseApiError(path, response))

const requestBodyWeightDelete = (
  id: string,
): ResultAsync<void, ApiRequestError> => {
  const path = `/api/body-weights/${encodeURIComponent(id)}`
  return ResultAsync.fromPromise(
    fetch(path, { method: 'DELETE' }),
    (cause) => new ApiRequestError(`request to ${path} failed`, cause),
  ).andThen((response) => {
    if (!response.ok) return parseApiError(path, response)
    return okAsync(undefined)
  })
}

export const fetchBodyWeights = (
  from: string,
  to: string,
): ResultAsync<ReadonlyArray<BodyWeight>, ApiRequestError> =>
  requestBodyWeightJson(
    `/api/body-weights?${new URLSearchParams({ from, to }).toString()}`,
    bodyWeightListSchema,
  )

export const postBodyWeight = (
  input: SaveBodyWeightInput,
): ResultAsync<BodyWeight, ApiRequestError> =>
  requestBodyWeightJson('/api/body-weights', bodyWeightSchema, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })

export const patchBodyWeight = (
  id: string,
  input: UpdateBodyWeightInput,
): ResultAsync<BodyWeight, ApiRequestError> => {
  const path = `/api/body-weights/${encodeURIComponent(id)}`
  return requestBodyWeightJson(path, bodyWeightSchema, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export const deleteBodyWeight = (
  id: string,
): ResultAsync<void, ApiRequestError> => requestBodyWeightDelete(id)
