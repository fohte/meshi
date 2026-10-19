import { z } from 'zod'

import { requestJson } from '#api/request'
import { parseApiError } from '#api/request-error'

const finiteNumberSchema = z.number().refine(Number.isFinite)

const stockCountResultSchema = z.object({
  foodMasterId: z.string(),
  previousQuantity: finiteNumberSchema,
  countedQuantity: finiteNumberSchema,
  difference: finiteNumberSchema,
})

export interface StockCountInput {
  readonly foodMasterId: string
  readonly quantity: number
  readonly receivedDate?: string | null
  readonly bestBefore?: string | null
}

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
