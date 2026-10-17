import { err, ok } from 'neverthrow'
import { z } from 'zod'

import type { Sql } from '#db/index'
import type { IdGenerator } from '#domain/food-master/id'
import { StockDomainError } from '#domain/stock/errors'
import {
  createStockWriteRunner,
  firstRow,
  numericString,
  parseRows,
} from '#domain/stock/stock-repository-utils'
import type {
  Delivery,
  DeliveryItem,
  ReceiveDeliveryInput,
} from '#domain/stock/types'

const deliveryRowSchema = z.object({
  id: z.string(),
  source_ref: z.string().nullable(),
  status: z.enum(['planned', 'received', 'cancelled']),
  expected_date: z.iso.date(),
  change_deadline: z.iso.date().nullable(),
})

const deliveryLotRowSchema = z.object({
  id: z.string(),
  food_master_id: z.string(),
  food_name: z.string(),
  quantity: numericString,
  eat_within_days: z.number().int().nullable(),
})

export const createStockDeliveryReceiver = (
  pgSql: Sql,
  generateId: IdGenerator,
  wrapInTransaction: boolean,
) => {
  const runWrite = createStockWriteRunner(pgSql, wrapInTransaction)

  return (input: ReceiveDeliveryInput) =>
    runWrite(async (tx) => {
      const deliveryRows = parseRows(
        deliveryRowSchema,
        await tx<Record<string, unknown>[]>`
          SELECT id, source_ref, status, expected_date::text AS expected_date,
                 change_deadline::text AS change_deadline
          FROM deliveries
          WHERE id = ${input.deliveryId}
          FOR UPDATE
        `,
        'lock delivery for receipt',
      )
      if (deliveryRows.isErr()) return err(deliveryRows.error)
      const delivery = firstRow(deliveryRows.value, 'load delivery for receipt')
      if (delivery.isErr()) {
        return err(
          new StockDomainError(
            'delivery_not_found',
            `delivery not found: ${input.deliveryId}`,
            { deliveryId: input.deliveryId },
          ),
        )
      }
      if (delivery.value.status !== 'planned') {
        return err(
          new StockDomainError(
            'delivery_not_planned',
            `delivery is ${delivery.value.status}: ${input.deliveryId}`,
            { deliveryId: input.deliveryId, status: delivery.value.status },
          ),
        )
      }

      const stockItemRows = parseRows(
        z.object({ food_master_id: z.string() }),
        await tx<Record<string, unknown>[]>`
          SELECT si.food_master_id
          FROM stock_items si
          WHERE si.food_master_id IN (
            SELECT sl.food_master_id
            FROM stock_lots sl
            WHERE sl.delivery_id = ${input.deliveryId}
          )
          ORDER BY si.food_master_id
          FOR UPDATE OF si
        `,
        'lock stock items for receipt',
      )
      if (stockItemRows.isErr()) return err(stockItemRows.error)

      // Stock counters lock stock_items before stock_lots; keep the same order.
      const lotRows = parseRows(
        deliveryLotRowSchema,
        await tx<Record<string, unknown>[]>`
          SELECT sl.id, sl.food_master_id, fm.name AS food_name,
                 sl.quantity::text AS quantity,
                 si.eat_within_days
          FROM stock_lots sl
          JOIN stock_items si ON si.food_master_id = sl.food_master_id
          JOIN food_masters fm ON fm.id = sl.food_master_id
          WHERE sl.delivery_id = ${input.deliveryId}
          ORDER BY sl.food_master_id
          FOR UPDATE OF sl
        `,
        'lock delivery lots for receipt',
      )
      if (lotRows.isErr()) return err(lotRows.error)

      const lotsByFoodId = new Map(
        lotRows.value.map((lot) => [lot.food_master_id, lot]),
      )
      const unexpectedItem = input.items?.find(
        (item) => !lotsByFoodId.has(item.foodMasterId),
      )
      if (unexpectedItem !== undefined) {
        return err(
          new StockDomainError(
            'delivery_item_not_found',
            `food_master is not part of delivery: ${unexpectedItem.foodMasterId}`,
            {
              deliveryId: input.deliveryId,
              foodMasterId: unexpectedItem.foodMasterId,
            },
          ),
        )
      }

      const actualQuantities = new Map(
        (input.items ?? []).map((item) => [item.foodMasterId, item.quantity]),
      )
      const receivedItems: DeliveryItem[] = []
      for (const lot of lotRows.value) {
        const quantity =
          actualQuantities.get(lot.food_master_id) ?? lot.quantity
        if (quantity === 0) {
          await tx`
            DELETE FROM stock_lots
            WHERE id = ${lot.id}
          `
        } else {
          await tx`
            UPDATE stock_lots sl
            SET quantity = ${quantity}::numeric,
                received_date = ${input.receivedDate}::date,
                eat_by = CASE
                  WHEN si.eat_within_days IS NULL THEN NULL
                  ELSE ${input.receivedDate}::date + si.eat_within_days
                END
            FROM stock_items si
            WHERE sl.id = ${lot.id}
              AND si.food_master_id = sl.food_master_id
          `
          await tx`
            INSERT INTO stock_movements (id, stock_lot_id, delta, reason)
            VALUES (${generateId('stm')}, ${lot.id}, ${quantity}::numeric, 'receive')
          `
        }

        receivedItems.push({
          foodMasterId: lot.food_master_id,
          foodName: lot.food_name,
          quantity,
        })
      }

      await tx`
        UPDATE deliveries
        SET status = 'received', received_date = ${input.receivedDate}::date
        WHERE id = ${input.deliveryId}
      `

      return ok({
        id: delivery.value.id,
        sourceRef: delivery.value.source_ref,
        status: 'received',
        expectedDate: delivery.value.expected_date,
        receivedDate: input.receivedDate,
        changeDeadline: delivery.value.change_deadline,
        items: receivedItems,
      } satisfies Delivery)
    })
}
