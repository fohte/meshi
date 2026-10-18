import { err, ok } from 'neverthrow'
import { z } from 'zod'

import type { Sql } from '#db/index'
import type { IdGenerator } from '#domain/food-master/id'
import { StockDomainError } from '#domain/stock/errors'
import {
  createStockWriteRunner,
  firstRow,
  parseRows,
} from '#domain/stock/stock-repository-utils'
import { stockItemRowSchema, toStockItem } from '#domain/stock/stock-rows'
import type { SetStockItemInput } from '#domain/stock/types'

const stockItemStateRowSchema = z.object({
  storage_location_id: z.string().nullable(),
  eat_within_days: z.number().int().nullable(),
})

const stockLocationRowSchema = z.object({ id: z.string() })
const foodMasterRowSchema = z.object({ id: z.string() })

export const createStockItemWriter = (
  pgSql: Sql,
  generateId: IdGenerator,
  wrapInTransaction: boolean,
) => {
  const runWrite = createStockWriteRunner(pgSql, wrapInTransaction)

  return (input: SetStockItemInput) =>
    runWrite(async (tx) => {
      const foodMasterRows = parseRows(
        foodMasterRowSchema,
        await tx<Record<string, unknown>[]>`
          SELECT id FROM food_masters
          WHERE id = ${input.foodMasterId}
          FOR UPDATE
        `,
        'load food_master',
      )
      if (foodMasterRows.isErr()) return err(foodMasterRows.error)
      if (foodMasterRows.value.length === 0) {
        return err(
          new StockDomainError(
            'food_master_not_found',
            `food_master not found: ${input.foodMasterId}`,
            { foodMasterId: input.foodMasterId },
          ),
        )
      }

      const itemStateRows = parseRows(
        stockItemStateRowSchema,
        await tx<Record<string, unknown>[]>`
          SELECT storage_location_id, eat_within_days
          FROM stock_items
          WHERE food_master_id = ${input.foodMasterId}
          FOR UPDATE
        `,
        'load stock_item',
      )
      if (itemStateRows.isErr()) return err(itemStateRows.error)
      const existing = itemStateRows.value[0]

      let storageLocationId = existing?.storage_location_id ?? null
      if (input.storageLocationName !== undefined) {
        if (input.storageLocationName === null) {
          storageLocationId = null
        } else {
          const locationRows = parseRows(
            stockLocationRowSchema,
            await tx<Record<string, unknown>[]>`
              INSERT INTO storage_locations (id, name, capacity)
              VALUES (
                ${generateId('sl')},
                ${input.storageLocationName},
                ${input.storageLocationCapacity ?? null}
              )
              ON CONFLICT (name) DO UPDATE SET
                capacity = CASE
                  WHEN ${input.storageLocationCapacity !== undefined}
                    THEN EXCLUDED.capacity
                  ELSE storage_locations.capacity
                END
              RETURNING id
            `,
            'upsert storage_location',
          )
          if (locationRows.isErr()) return err(locationRows.error)
          const locationRow = firstRow(
            locationRows.value,
            'upsert storage_location',
          )
          if (locationRow.isErr()) return err(locationRow.error)
          storageLocationId = locationRow.value.id
        }
      }

      if (
        input.storageLocationCapacity !== undefined &&
        input.storageLocationName === undefined
      ) {
        if (storageLocationId === null) {
          return err(
            new StockDomainError(
              'invalid_input',
              'storage_location_capacity requires an assigned storage location',
            ),
          )
        }
        const updatedLocationRows = parseRows(
          stockLocationRowSchema,
          await tx<Record<string, unknown>[]>`
            UPDATE storage_locations
            SET capacity = ${input.storageLocationCapacity}
            WHERE id = ${storageLocationId}
            RETURNING id
          `,
          'update storage_location',
        )
        if (updatedLocationRows.isErr()) return err(updatedLocationRows.error)
        if (updatedLocationRows.value.length === 0) {
          return err(
            new StockDomainError(
              'invalid_input',
              'assigned storage location no longer exists',
            ),
          )
        }
      }

      const eatWithinDays =
        input.eatWithinDays === undefined
          ? (existing?.eat_within_days ?? null)
          : input.eatWithinDays

      if (existing === undefined) {
        await tx`
          INSERT INTO stock_items (
            food_master_id, storage_location_id, eat_within_days
          ) VALUES (
            ${input.foodMasterId}, ${storageLocationId}, ${eatWithinDays}
          )
        `
      } else {
        await tx`
          UPDATE stock_items SET
            storage_location_id = ${storageLocationId},
            eat_within_days = ${eatWithinDays}
          WHERE food_master_id = ${input.foodMasterId}
        `
      }

      if (eatWithinDays !== null) {
        await tx`
          UPDATE stock_lots
          SET eat_by = received_date + ${eatWithinDays}::int
          WHERE food_master_id = ${input.foodMasterId}
            AND eat_by IS NULL
            AND received_date IS NOT NULL
        `
      }

      const stockItemRows = parseRows(
        stockItemRowSchema,
        await tx<Record<string, unknown>[]>`
          SELECT si.food_master_id, fm.name AS food_name,
                 sl.name AS storage_location_name,
                 sl.capacity::text AS storage_location_capacity,
                 si.eat_within_days
          FROM stock_items si
          JOIN food_masters fm ON fm.id = si.food_master_id
          LEFT JOIN storage_locations sl ON sl.id = si.storage_location_id
          WHERE si.food_master_id = ${input.foodMasterId}
        `,
        'load updated stock_item',
      )
      if (stockItemRows.isErr()) return err(stockItemRows.error)
      const stockItem = firstRow(stockItemRows.value, 'load updated stock_item')
      return stockItem.isErr()
        ? err(stockItem.error)
        : ok(toStockItem(stockItem.value))
    })
}
