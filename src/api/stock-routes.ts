import type { Hono } from 'hono'

import { jsonServerError } from '#api/errors'
import type { StockService } from '#domain/stock/types'

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
}
