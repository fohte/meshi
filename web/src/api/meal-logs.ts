import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import { MEAL_TYPES, type MealType } from '#api/day-detail'
import { ApiRequestError } from '#api/errors'
import { nutritionStatusSchema } from '#api/nutrition-status'
import { requestJson } from '#api/request'

const mealLogResultSchema = z.object({
  id: z.string(),
  foodMasterId: z.string(),
  eatenDate: z.string(),
  mealType: z.enum(MEAL_TYPES),
  quantity: z.number(),
  nutrition: z.record(z.string(), z.number()),
  isEstimated: z.boolean(),
  nutritionStatus: nutritionStatusSchema,
  createdAt: z.iso.datetime(),
})

const mealLogBatchErrorSchema = z.object({
  error: z.string(),
  itemIndex: z.number().int().positive().optional(),
})

export type MealLogResult = z.infer<typeof mealLogResultSchema>
export type RecordMealLogBatchResult = ReadonlyArray<MealLogResult>

export class BatchMealLogRequestError extends ApiRequestError {
  constructor(
    message: string,
    readonly itemIndex: number | null,
    cause: unknown,
  ) {
    super(message, cause)
  }
}

export interface RecordMealLogInput {
  readonly foodMasterId: string
  readonly eatenDate: string
  readonly mealType: MealType
  readonly quantity: number
}

export interface RecordBatchMealLogInput {
  readonly eatenDate: string
  readonly mealType: MealType
  readonly items: ReadonlyArray<{
    readonly foodMasterId: string
    readonly quantity: number
  }>
}

export interface UpdateMealLogInput {
  readonly foodMasterId?: string
  readonly eatenDate?: string
  readonly mealType?: MealType
  readonly quantity?: number
}

const parseBatchMealLogError = (
  path: string,
  response: Response,
): ResultAsync<never, ApiRequestError> =>
  ResultAsync.fromPromise(
    response.json() as Promise<unknown>,
    (cause) =>
      new ApiRequestError(
        `${path} responded with ${String(response.status)}`,
        cause,
      ),
  ).andThen((body) => {
    const parsed = mealLogBatchErrorSchema.safeParse(body)
    if (!parsed.success) {
      return errAsync(
        new ApiRequestError(
          `${path} responded with ${String(response.status)}`,
          parsed.error,
        ),
      )
    }
    return errAsync(
      new BatchMealLogRequestError(
        parsed.data.error,
        parsed.data.itemIndex ?? null,
        undefined,
      ),
    )
  })

export const postMealLog = (
  input: RecordMealLogInput,
): ResultAsync<MealLogResult, ApiRequestError> =>
  requestJson('/api/meal-logs', mealLogResultSchema, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })

export const postMealLogs = (
  input: RecordBatchMealLogInput,
): ResultAsync<RecordMealLogBatchResult, ApiRequestError> =>
  requestJson(
    '/api/meal-logs',
    z.array(mealLogResultSchema),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    (response) => parseBatchMealLogError('/api/meal-logs', response),
  )

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
