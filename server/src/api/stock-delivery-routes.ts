import type { Context, Hono } from 'hono'
import { z } from 'zod'

import { jsonBadRequest, jsonServerError, parseJsonBody } from '#api/errors'
import { StockDomainError } from '#domain/stock/errors'
import type { Delivery, StockService } from '#domain/stock/types'

const deliveryItemBodySchema = z.object({
  foodMasterId: z.string(),
  quantity: z.number(),
})

const registerDeliveryBodySchema = z.object({
  sourceRef: z.string().min(1),
  status: z.enum(['planned', 'cancelled']),
  expectedDate: z.iso.date(),
  changeDeadline: z.iso.date().nullable().optional(),
  items: z.array(deliveryItemBodySchema),
})

const receiveDeliveryBodySchema = z.object({
  receivedDate: z.iso.date(),
  items: z.array(deliveryItemBodySchema).optional(),
})

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

const notFoundCodes = new Set([
  'food_master_not_found',
  'stock_item_not_found',
  'delivery_not_found',
  'delivery_item_not_found',
])

const stockDeliveryErrorResponse = (
  c: Context,
  error: StockDomainError,
): Response => {
  if (error.code === 'invalid_input') {
    return jsonBadRequest(c, error.message)
  }
  if (notFoundCodes.has(error.code)) {
    return c.json({ error: error.message }, 404)
  }
  if (error.code === 'delivery_not_planned') {
    return c.json({ error: error.message }, 409)
  }
  return jsonServerError(c, error)
}

const deliveryResponse = (c: Context, delivery: Delivery): Response => {
  const parsed = deliverySchema.safeParse(delivery)
  if (!parsed.success) {
    return jsonServerError(
      c,
      new Error('stock delivery response did not match the expected schema'),
    )
  }
  return c.json(parsed.data)
}

export const mountStockDeliveryRoutes = (
  app: Hono,
  stockService: StockService,
): void => {
  app.post('/api/stock/deliveries', async (c) => {
    const parsed = await parseJsonBody(c, registerDeliveryBodySchema)
    if (parsed.isErr()) return parsed.error

    const result = await stockService.registerDelivery({
      sourceRef: parsed.value.sourceRef,
      status: parsed.value.status,
      expectedDate: parsed.value.expectedDate,
      items: parsed.value.items,
      ...(parsed.value.changeDeadline === undefined
        ? {}
        : { changeDeadline: parsed.value.changeDeadline }),
    })
    return result.match(
      (delivery) => deliveryResponse(c, delivery),
      (error) => stockDeliveryErrorResponse(c, error),
    )
  })

  app.post('/api/stock/deliveries/:id/receive', async (c) => {
    const parsed = await parseJsonBody(c, receiveDeliveryBodySchema)
    if (parsed.isErr()) return parsed.error

    const result = await stockService.receiveDelivery({
      deliveryId: c.req.param('id'),
      receivedDate: parsed.value.receivedDate,
      ...(parsed.value.items === undefined
        ? {}
        : { items: parsed.value.items }),
    })
    return result.match(
      (delivery) => deliveryResponse(c, delivery),
      (error) => stockDeliveryErrorResponse(c, error),
    )
  })
}
