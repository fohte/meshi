import { err, ok } from 'neverthrow'
import { z } from 'zod'

import type { Sql } from '#db/index'
import type { IdGenerator } from '#domain/food-master/id'
import { StockDomainError } from '#domain/stock/errors'
import {
  createStockWriteRunner,
  parseRows,
} from '#domain/stock/stock-repository-utils'
import type {
  Delivery,
  DeliveryItem,
  RegisterDeliveryInput,
} from '#domain/stock/types'

const deliveryRowSchema = z.object({
  id: z.string(),
  status: z.enum(['planned', 'received', 'cancelled']),
})

const stockFoodRowSchema = z.object({
  food_master_id: z.string(),
  food_name: z.string(),
})

export const createStockDeliveryWriter = (
  pgSql: Sql,
  generateId: IdGenerator,
  wrapInTransaction: boolean,
) => {
  const runWrite = createStockWriteRunner(pgSql, wrapInTransaction)

  return (input: RegisterDeliveryInput) =>
    runWrite(async (tx) => {
      const sourceRef = input.sourceRef ?? null
      const foodMasterIds = input.items.map((item) => item.foodMasterId)
      if (foodMasterIds.length > 0) {
        const stockItemRows = parseRows(
          z.object({ food_master_id: z.string() }),
          await tx<Record<string, unknown>[]>`
            SELECT food_master_id
            FROM stock_items
            WHERE food_master_id = ANY(${foodMasterIds}::text[])
          `,
          'validate delivery stock items',
        )
        if (stockItemRows.isErr()) return err(stockItemRows.error)
        const stockItemIds = new Set(
          stockItemRows.value.map((row) => row.food_master_id),
        )
        const missingFood = input.items.find(
          (item) => !stockItemIds.has(item.foodMasterId),
        )
        if (missingFood !== undefined) {
          return err(
            new StockDomainError(
              'stock_item_not_found',
              'food_master is not a stock_item',
              { foodMasterId: missingFood.foodMasterId },
            ),
          )
        }
      }
      const deliveryRows = parseRows(
        deliveryRowSchema,
        await tx<Record<string, unknown>[]>`
          INSERT INTO deliveries (
            id, source_ref, status, expected_date, change_deadline
          ) VALUES (
            ${generateId('dly')}, ${sourceRef}, ${input.status},
            ${input.expectedDate}::date, ${input.changeDeadline ?? null}::date
          )
          ON CONFLICT (source_ref) DO UPDATE
            SET source_ref = EXCLUDED.source_ref
          WHERE deliveries.status <> 'received'
          RETURNING id, status
        `,
        'upsert delivery',
      )
      if (deliveryRows.isErr()) return err(deliveryRows.error)
      let delivery = deliveryRows.value[0]
      if (delivery === undefined && sourceRef !== null) {
        const existingRows = parseRows(
          deliveryRowSchema,
          await tx<Record<string, unknown>[]>`
            SELECT id, status
            FROM deliveries
            WHERE source_ref = ${sourceRef}
            FOR UPDATE
          `,
          'load existing delivery',
        )
        if (existingRows.isErr()) return err(existingRows.error)
        delivery = existingRows.value[0]
      }
      if (delivery === undefined) {
        return err(
          new StockDomainError(
            'persistence_failed',
            'upsert delivery returned no row',
          ),
        )
      }
      if (delivery.status === 'received') {
        return err(
          new StockDomainError(
            'delivery_not_planned',
            'received deliveries cannot be changed',
            { deliveryId: delivery.id },
          ),
        )
      }

      let stockFoodRows: z.output<typeof stockFoodRowSchema>[] = []
      if (foodMasterIds.length > 0) {
        const parsedStockFoods = parseRows(
          stockFoodRowSchema,
          await tx<Record<string, unknown>[]>`
            SELECT si.food_master_id, fm.name AS food_name
            FROM stock_items si
            JOIN food_masters fm ON fm.id = si.food_master_id
            WHERE si.food_master_id = ANY(${foodMasterIds}::text[])
            ORDER BY si.food_master_id
            FOR UPDATE OF si
          `,
          'load delivery stock items',
        )
        if (parsedStockFoods.isErr()) return err(parsedStockFoods.error)
        stockFoodRows = parsedStockFoods.value
      }

      const stockFoodsById = new Map(
        stockFoodRows.map((food) => [food.food_master_id, food.food_name]),
      )
      const missingFood = input.items.find(
        (item) => !stockFoodsById.has(item.foodMasterId),
      )
      if (missingFood !== undefined) {
        return err(
          new StockDomainError(
            'stock_item_not_found',
            `food_master is not a stock_item: ${missingFood.foodMasterId}`,
            { foodMasterId: missingFood.foodMasterId },
          ),
        )
      }

      const deliveryItems: DeliveryItem[] = []
      for (const item of input.items) {
        const foodName = stockFoodsById.get(item.foodMasterId)
        if (foodName === undefined) {
          return err(
            new StockDomainError(
              'persistence_failed',
              'validated delivery food was not found',
              { foodMasterId: item.foodMasterId },
            ),
          )
        }
        deliveryItems.push({
          foodMasterId: item.foodMasterId,
          foodName,
          quantity: item.quantity,
        })
      }

      await tx`
        UPDATE deliveries
        SET status = ${input.status},
            expected_date = ${input.expectedDate}::date,
            received_date = NULL,
            change_deadline = ${input.changeDeadline ?? null}::date
        WHERE id = ${delivery.id}
      `
      await tx`DELETE FROM stock_lots WHERE delivery_id = ${delivery.id}`
      for (const item of input.items) {
        await tx`
          INSERT INTO stock_lots (id, food_master_id, delivery_id, quantity)
          VALUES (
            ${generateId('stl')}, ${item.foodMasterId},
            ${delivery.id}, ${item.quantity}::numeric
          )
        `
      }

      return ok({
        id: delivery.id,
        sourceRef,
        status: input.status,
        expectedDate: input.expectedDate,
        receivedDate: null,
        changeDeadline: input.changeDeadline ?? null,
        items: deliveryItems,
      } satisfies Delivery)
    })
}
