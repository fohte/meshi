import { errAsync, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import { ApiRequestError } from '#api/errors'
import { requestJson } from '#api/request'

const deliverySchema = z.object({
  id: z.string(),
  sourceRef: z.string().nullable(),
  status: z.enum(['planned', 'received', 'cancelled']),
  expectedDate: z.iso.date(),
  receivedDate: z.iso.date().nullable(),
  changeDeadline: z.iso.date().nullable(),
  items: z.array(
    z.object({
      foodMasterId: z.string(),
      foodName: z.string(),
      quantity: z.number(),
    }),
  ),
})

const apiErrorSchema = z.object({ error: z.string() })

export type StockDelivery = z.infer<typeof deliverySchema>

interface StockDeliveryItemInput {
  readonly foodMasterId: string
  readonly quantity: number
}

export interface RegisterStockDeliveryInput {
  readonly sourceRef: string
  readonly status: 'planned' | 'cancelled'
  readonly expectedDate: string
  readonly changeDeadline?: string | null
  readonly items: ReadonlyArray<StockDeliveryItemInput>
}

export interface ReceiveStockDeliveryInput {
  readonly receivedDate: string
  readonly items?: ReadonlyArray<StockDeliveryItemInput>
}

export class StockDeliveryRequestError extends ApiRequestError {
  readonly status: number

  constructor(message: string, status: number, cause?: unknown) {
    super(message, cause)
    this.status = status
  }
}

const parseHttpError = (
  path: string,
  response: Response,
): ResultAsync<never, ApiRequestError> =>
  ResultAsync.fromPromise(
    response.json() as Promise<unknown>,
    (cause) =>
      new StockDeliveryRequestError(
        `${path} responded with ${String(response.status)}`,
        response.status,
        cause,
      ),
  ).andThen((body) => {
    const parsed = apiErrorSchema.safeParse(body)
    return errAsync(
      new StockDeliveryRequestError(
        parsed.success
          ? parsed.data.error
          : `${path} responded with ${String(response.status)}`,
        response.status,
        parsed.success ? undefined : parsed.error,
      ),
    )
  })

export const registerStockDelivery = (
  input: RegisterStockDeliveryInput,
): ResultAsync<StockDelivery, ApiRequestError> => {
  const path = '/api/stock/deliveries'
  return requestJson(
    path,
    deliverySchema,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    (response) => parseHttpError(path, response),
  )
}

export const receiveStockDelivery = (
  id: string,
  input: ReceiveStockDeliveryInput,
): ResultAsync<StockDelivery, ApiRequestError> => {
  const path = `/api/stock/deliveries/${encodeURIComponent(id)}/receive`
  return requestJson(
    path,
    deliverySchema,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    (response) => parseHttpError(path, response),
  )
}
