import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { Sql } from '#db/index'
import { StockDomainError } from '#domain/stock/errors'
import {
  numericString,
  parseRows,
  toStockError,
} from '#domain/stock/stock-repository-utils'
import { stockItemRowSchema, toStockItem } from '#domain/stock/stock-rows'
import type { StockItemStatus } from '#domain/stock/types'

const stockLotStatusSchema = z.object({
  stock_lot_id: z.string(),
  quantity: numericString,
  remaining_quantity: numericString,
  received_date: z.iso.date().nullable(),
  best_before: z.iso.date().nullable(),
  eat_by: z.iso.date().nullable(),
})

const stockStatusRowSchema = stockItemRowSchema.extend({
  total_quantity: numericString,
  lots: z.array(stockLotStatusSchema),
})

export const createStockStatusReader =
  (
    pgSql: Sql,
  ): (() => ResultAsync<ReadonlyArray<StockItemStatus>, StockDomainError>) =>
  () =>
    ResultAsync.fromPromise(
      pgSql<Record<string, unknown>[]>`
        WITH lot_balances AS (
          SELECT sl.id, sl.food_master_id, sl.quantity::text AS quantity,
                 sl.received_date::text AS received_date,
                 sl.best_before::text AS best_before,
                 sl.eat_by::text AS eat_by,
                 sl.created_at,
                 COALESCE(SUM(sm.delta), 0)::text AS remaining
          FROM stock_lots sl
          LEFT JOIN stock_movements sm ON sm.stock_lot_id = sl.id
          GROUP BY sl.id
        ), active_lots AS (
          SELECT * FROM lot_balances WHERE remaining::numeric > 0
        )
        SELECT si.food_master_id, fm.name AS food_name,
               sl.name AS storage_location_name,
               sl.capacity::text AS storage_location_capacity,
               si.eat_within_days,
               COALESCE(SUM(al.remaining::numeric), 0)::text AS total_quantity,
               COALESCE(
                 jsonb_agg(
                   jsonb_build_object(
                     'stock_lot_id', al.id,
                     'quantity', al.quantity,
                     'remaining_quantity', al.remaining,
                     'received_date', al.received_date,
                     'best_before', al.best_before,
                     'eat_by', al.eat_by
                   ) ORDER BY al.received_date ASC NULLS FIRST,
                              al.created_at ASC, al.id ASC
                 ) FILTER (WHERE al.id IS NOT NULL),
                 '[]'::jsonb
               ) AS lots
        FROM stock_items si
        JOIN food_masters fm ON fm.id = si.food_master_id
        LEFT JOIN storage_locations sl ON sl.id = si.storage_location_id
        LEFT JOIN active_lots al ON al.food_master_id = si.food_master_id
        GROUP BY si.food_master_id, fm.name, sl.id, sl.name, sl.capacity,
                 si.eat_within_days
        ORDER BY fm.name, si.food_master_id
      `,
      toStockError,
    ).andThen((rows) => {
      const parsed = parseRows(stockStatusRowSchema, rows, 'get stock status')
      if (parsed.isErr()) return errAsync(parsed.error)
      return okAsync(
        parsed.value.map((row) => ({
          ...toStockItem(row),
          totalQuantity: row.total_quantity,
          lots: row.lots.map((lot) => ({
            id: lot.stock_lot_id,
            quantity: lot.quantity,
            remainingQuantity: lot.remaining_quantity,
            receivedDate: lot.received_date,
            bestBefore: lot.best_before,
            eatBy: lot.eat_by,
          })),
        })),
      )
    })
