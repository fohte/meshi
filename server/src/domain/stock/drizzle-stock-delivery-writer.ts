import { err, ok, Result } from 'neverthrow'
import { z } from 'zod'

import type { Sql } from '#db/index'
import type { IdGenerator } from '#domain/food-master/id'
import { StockDomainError } from '#domain/stock/errors'
import {
  createStockWriteRunner,
  firstRow,
  parseRows,
} from '#domain/stock/stock-repository-utils'
import type {
  Delivery,
  DeliveryItem,
  RegisterDeliveryInput,
} from '#domain/stock/types'

const deliveryRowSchema = z.object({
  id: z.string(),
  source_ref: z.string().nullable(),
  status: z.enum(['planned', 'received', 'cancelled']),
})

const sourceRefOwnerSchema = z.object({ delivery_id: z.string() })

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
      const items = input.status === 'cancelled' ? [] : input.items
      const foodMasterIds = items.map((item) => item.foodMasterId)
      let delivery: z.output<typeof deliveryRowSchema> | undefined

      if (sourceRef !== null) {
        const existingRows = parseRows(
          deliveryRowSchema,
          await tx<Record<string, unknown>[]>`
            SELECT d.id, d.source_ref, d.status
            FROM delivery_source_refs dsr
            JOIN deliveries d ON d.id = dsr.delivery_id
            WHERE dsr.source_ref = ${sourceRef}
            FOR UPDATE OF d
          `,
          'load delivery by source reference',
        )
        if (existingRows.isErr()) return err(existingRows.error)
        delivery = existingRows.value[0]
      }
      if (delivery?.status === 'received') {
        return err(
          new StockDomainError(
            'delivery_not_planned',
            'received deliveries cannot be changed',
            { deliveryId: delivery.id },
          ),
        )
      }

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
        const missingFood = items.find(
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

      if (delivery === undefined) {
        const createdRows = parseRows(
          deliveryRowSchema,
          await tx<Record<string, unknown>[]>`
            INSERT INTO deliveries (
              id, source_ref, status, expected_date, change_deadline
            ) VALUES (
              ${generateId('dly')}, NULL, ${input.status},
              ${input.expectedDate}::date, ${input.changeDeadline ?? null}::date
            )
            RETURNING id, source_ref, status
          `,
          'create delivery',
        )
        if (createdRows.isErr()) return err(createdRows.error)
        const created = firstRow(createdRows.value, 'create delivery')
        if (created.isErr()) return err(created.error)
        delivery = created.value

        if (sourceRef !== null) {
          const claimRows = parseRows(
            sourceRefOwnerSchema,
            await tx<Record<string, unknown>[]>`
              INSERT INTO delivery_source_refs (
                source_ref, delivery_id, created_at
              ) VALUES (
                ${sourceRef}, ${delivery.id}, statement_timestamp()
              )
              ON CONFLICT (source_ref) DO NOTHING
              RETURNING delivery_id
            `,
            'claim delivery source reference',
          )
          if (claimRows.isErr()) return err(claimRows.error)
          if (claimRows.value.length === 0) {
            const ownerRows = parseRows(
              sourceRefOwnerSchema,
              await tx<Record<string, unknown>[]>`
                SELECT delivery_id
                FROM delivery_source_refs
                WHERE source_ref = ${sourceRef}
              `,
              'load source reference owner',
            )
            if (ownerRows.isErr()) return err(ownerRows.error)
            const owner = firstRow(
              ownerRows.value,
              'load source reference owner',
            )
            if (owner.isErr()) return err(owner.error)
            return err(
              new StockDomainError(
                'delivery_source_ref_conflict',
                `source_ref is already used by delivery ${owner.value.delivery_id}`,
                {
                  sourceRef,
                  deliveryId: delivery.id,
                  conflictingDeliveryId: owner.value.delivery_id,
                },
              ),
            )
          }

          const attachedRows = parseRows(
            deliveryRowSchema,
            await tx<Record<string, unknown>[]>`
              UPDATE deliveries
              SET source_ref = ${sourceRef}
              WHERE id = ${delivery.id}
              RETURNING id, source_ref, status
            `,
            'attach source reference to delivery',
          )
          if (attachedRows.isErr()) return err(attachedRows.error)
          const attached = firstRow(
            attachedRows.value,
            'attach source reference to delivery',
          )
          if (attached.isErr()) return err(attached.error)
          delivery = attached.value
        }
      }

      let stockFoodRows: z.output<typeof stockFoodRowSchema>[] = []
      if (foodMasterIds.length > 0) {
        // Keep the same lock order as receipt to avoid deadlocks.
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
        stockFoodRows.map((food) => [food.food_master_id, food] as const),
      )
      const deliveryItemsResult = Result.combine(
        items.map((item) => {
          const food = stockFoodsById.get(item.foodMasterId)
          return food === undefined
            ? err(
                new StockDomainError(
                  'stock_item_not_found',
                  `food_master is not a stock_item: ${item.foodMasterId}`,
                  { foodMasterId: item.foodMasterId },
                ),
              )
            : ok({
                foodMasterId: item.foodMasterId,
                foodName: food.food_name,
                quantity: item.quantity,
              } satisfies DeliveryItem)
        }),
      )
      if (deliveryItemsResult.isErr()) return err(deliveryItemsResult.error)
      const deliveryItems = deliveryItemsResult.value

      await tx`
        UPDATE deliveries
        SET status = ${input.status},
            expected_date = ${input.expectedDate}::date,
            received_date = NULL,
            change_deadline = ${input.changeDeadline ?? null}::date
        WHERE id = ${delivery.id}
      `
      await tx`DELETE FROM stock_lots WHERE delivery_id = ${delivery.id}`
      for (const item of items) {
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
        sourceRef: delivery.source_ref,
        status: input.status,
        expectedDate: input.expectedDate,
        receivedDate: null,
        changeDeadline: input.changeDeadline ?? null,
        items: deliveryItems,
      } satisfies Delivery)
    })
}
