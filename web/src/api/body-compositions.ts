import { okAsync, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import { ApiRequestError } from '#api/errors'
import { requestJson } from '#api/request'
import { parseApiError } from '#api/request-error'

const bodyCompositionSchema = z.object({
  id: z.string(),
  date: z.iso.date(),
  measuredAt: z.iso.datetime().nullable(),
  device: z.string(),
  bodyFatPercent: z.number().nullable(),
  muscleMassKg: z.number().nullable(),
  skeletalMusclePercent: z.number().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

const bodyCompositionListSchema = z.array(bodyCompositionSchema)
export type BodyComposition = z.infer<typeof bodyCompositionSchema>

export interface SaveBodyCompositionInput {
  readonly date: string
  readonly measuredAt?: string
  readonly device: string
  readonly bodyFatPercent?: number
  readonly muscleMassKg?: number
  readonly skeletalMusclePercent?: number
}

export interface UpdateBodyCompositionInput {
  readonly date?: string
  readonly measuredAt?: string | null
  readonly device?: string
  readonly bodyFatPercent?: number | null
  readonly muscleMassKg?: number | null
  readonly skeletalMusclePercent?: number | null
}

export const BODY_COMPOSITIONS_QUERY_KEY = ['body-compositions']

const requestBodyCompositionJson = <Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  init?: RequestInit,
): ResultAsync<z.infer<Schema>, ApiRequestError> =>
  requestJson(path, schema, init, (response) => parseApiError(path, response))

const requestBodyCompositionDelete = (
  id: string,
): ResultAsync<void, ApiRequestError> => {
  const path = `/api/body-compositions/${encodeURIComponent(id)}`
  return ResultAsync.fromPromise(
    fetch(path, { method: 'DELETE' }),
    (cause) => new ApiRequestError(`request to ${path} failed`, cause),
  ).andThen((response) => {
    if (!response.ok) return parseApiError(path, response)
    return okAsync(undefined)
  })
}

export const fetchBodyCompositions = (
  from: string,
  to: string,
): ResultAsync<ReadonlyArray<BodyComposition>, ApiRequestError> =>
  requestBodyCompositionJson(
    `/api/body-compositions?${new URLSearchParams({ from, to }).toString()}`,
    bodyCompositionListSchema,
  )

export const postBodyComposition = (
  input: SaveBodyCompositionInput,
): ResultAsync<BodyComposition, ApiRequestError> =>
  requestBodyCompositionJson('/api/body-compositions', bodyCompositionSchema, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })

export const patchBodyComposition = (
  id: string,
  input: UpdateBodyCompositionInput,
): ResultAsync<BodyComposition, ApiRequestError> => {
  const path = `/api/body-compositions/${encodeURIComponent(id)}`
  return requestBodyCompositionJson(path, bodyCompositionSchema, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export const deleteBodyComposition = (
  id: string,
): ResultAsync<void, ApiRequestError> => requestBodyCompositionDelete(id)
