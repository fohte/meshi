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
import type { StockStatus } from '#domain/stock/types'

const stockLotStatusSchema = z.object({
  stock_lot_id: z.string(),
  quantity: numericString,
  remaining_quantity: numericString,
  received_date: z.iso.date().nullable(),
  best_before: z.iso.date().nullable(),
  eat_by: z.iso.date().nullable(),
})

const stockItemStatusSchema = stockItemRowSchema.extend({
  total_quantity: numericString,
  lots: z.array(stockLotStatusSchema),
})

const deliveryItemSchema = z.object({
  food_master_id: z.string(),
  food_name: z.string(),
  quantity: numericString,
})

const plannedDeliverySchema = z.object({
  id: z.string(),
  source_ref: z.string().nullable(),
  expected_date: z.iso.date(),
  change_deadline: z.iso.date().nullable(),
  items: z.array(deliveryItemSchema),
})

const stockStatusRowSchema = z.object({
  stock_items: z.array(stockItemStatusSchema),
  planned_deliveries: z.array(plannedDeliverySchema),
})

export const createStockStatusReader =
  (pgSql: Sql): (() => ResultAsync<StockStatus, StockDomainError>) =>
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
        ), stock_item_status AS (
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
        ), planned_delivery_status AS (
          SELECT d.id, d.source_ref, d.expected_date::text AS expected_date,
                 d.change_deadline::text AS change_deadline,
                 COALESCE(
                   jsonb_agg(
                     jsonb_build_object(
                       'food_master_id', sl.food_master_id,
                       'food_name', fm.name,
                       'quantity', sl.quantity::text
                     ) ORDER BY fm.name, sl.food_master_id
                   ) FILTER (WHERE sl.id IS NOT NULL),
                   '[]'::jsonb
                 ) AS items
          FROM deliveries d
          LEFT JOIN stock_lots sl ON sl.delivery_id = d.id
          LEFT JOIN food_masters fm ON fm.id = sl.food_master_id
          WHERE d.status = 'planned'
          GROUP BY d.id
        )
        SELECT
          COALESCE(
            (
              SELECT jsonb_agg(
                to_jsonb(si) ORDER BY si.food_name, si.food_master_id
              )
              FROM stock_item_status si
            ),
            '[]'::jsonb
          ) AS stock_items,
          COALESCE(
            (
              SELECT jsonb_agg(
                to_jsonb(pd) ORDER BY pd.expected_date, pd.id
              )
              FROM planned_delivery_status pd
            ),
            '[]'::jsonb
          ) AS planned_deliveries
      `,
      toStockError,
    ).andThen((rows) => {
      const parsed = parseRows(stockStatusRowSchema, rows, 'get stock status')
      if (parsed.isErr()) return errAsync(parsed.error)
      const row = parsed.value[0]
      if (row === undefined) {
        return errAsync(
          new StockDomainError(
            'persistence_failed',
            'get stock status returned no rows',
          ),
        )
      }

      return okAsync({
        stockItems: row.stock_items.map((item) => ({
          ...toStockItem(item),
          totalQuantity: item.total_quantity,
          lots: item.lots.map((lot) => ({
            id: lot.stock_lot_id,
            quantity: lot.quantity,
            remainingQuantity: lot.remaining_quantity,
            receivedDate: lot.received_date,
            bestBefore: lot.best_before,
            eatBy: lot.eat_by,
          })),
        })),
        plannedDeliveries: row.planned_deliveries.map((delivery) => ({
          id: delivery.id,
          sourceRef: delivery.source_ref,
          expectedDate: delivery.expected_date,
          changeDeadline: delivery.change_deadline,
          items: delivery.items.map((item) => ({
            foodMasterId: item.food_master_id,
            foodName: item.food_name,
            quantity: item.quantity,
          })),
        })),
      })
    })
