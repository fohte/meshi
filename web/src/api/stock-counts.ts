import { errAsync, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import { ApiRequestError } from '#api/errors'
import { requestJson } from '#api/request'

const finiteNumberSchema = z.number().refine(Number.isFinite)

const stockCountResultSchema = z.object({
  foodMasterId: z.string(),
  previousQuantity: finiteNumberSchema,
  countedQuantity: finiteNumberSchema,
  difference: finiteNumberSchema,
})

const apiErrorSchema = z.object({ error: z.string() })

export interface StockCountInput {
  readonly foodMasterId: string
  readonly quantity: number
  readonly receivedDate?: string | null
  readonly bestBefore?: string | null
}

const parseApiError = (
  path: string,
  response: Response,
): ResultAsync<never, ApiRequestError> =>
  ResultAsync.fromPromise(
    response.json(),
    (cause) =>
      new ApiRequestError(
        `${path} responded with ${String(response.status)}`,
        cause,
      ),
  ).andThen((body: unknown) => {
    const parsed = apiErrorSchema.safeParse(body)
    if (!parsed.success) {
      return errAsync(
        new ApiRequestError(
          `${path} responded with ${String(response.status)}`,
          parsed.error,
        ),
      )
    }
    return errAsync(new ApiRequestError(parsed.data.error, undefined))
  })

export const postStockCount = (input: StockCountInput) =>
  requestJson(
    '/api/stock/counts',
    stockCountResultSchema,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    (response) => parseApiError('/api/stock/counts', response),
  )
