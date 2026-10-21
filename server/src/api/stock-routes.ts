import type { Context, Hono } from 'hono'
import { z } from 'zod'

import { jsonBadRequest, jsonServerError, parseJsonBody } from '#api/errors'
import { StockDomainError } from '#domain/stock/errors'
import type { StockService } from '#domain/stock/types'

const stockCountBodySchema = z.object({
  foodMasterId: z.string().min(1),
  quantity: z.number().min(0).refine(Number.isFinite),
  receivedDate: z.iso.date().nullable().optional(),
  bestBefore: z.iso.date().nullable().optional(),
})

const stockCountErrorResponse = (
  c: Context,
  error: StockDomainError,
): Response => {
  if (
    error.code === 'food_master_not_found' ||
    error.code === 'stock_item_not_found'
  ) {
    return c.json({ error: error.message }, 404)
  }
  if (error.code === 'invalid_input') {
    return jsonBadRequest(c, error.message)
  }
  return jsonServerError(c, error)
}

export const mountStockRoutes = (
  app: Hono,
  stockService: StockService,
): void => {
  app.get('/api/stock', async (c) => {
    const result = await stockService.getStockStatus()
    return result.match(
      (stockStatus) => c.json(stockStatus),
      (error) => jsonServerError(c, error),
    )
  })

  app.post('/api/stock/counts', async (c) => {
    const parsed = await parseJsonBody(c, stockCountBodySchema)
    if (parsed.isErr()) return parsed.error

    const result = await stockService.countStock({
      foodMasterId: parsed.value.foodMasterId,
      quantity: parsed.value.quantity,
      ...(parsed.value.receivedDate === undefined
        ? {}
        : { receivedDate: parsed.value.receivedDate }),
      ...(parsed.value.bestBefore === undefined
        ? {}
        : { bestBefore: parsed.value.bestBefore }),
    })
    return result.match(
      (countResult) => c.json(countResult),
      (error) => stockCountErrorResponse(c, error),
    )
  })
}
