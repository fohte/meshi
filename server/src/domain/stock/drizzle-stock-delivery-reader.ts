import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { Sql, SqlOrTx } from '#db/index'
import { StockDomainError } from '#domain/stock/errors'
import {
  numericString,
  parseRows,
  toStockError,
} from '#domain/stock/stock-repository-utils'
import type { ListDeliveriesInput, ListedDelivery } from '#domain/stock/types'

const deliveryLotItemSchema = z.object({
  food_master_id: z.string(),
  food_name: z.string(),
  stock_lot_id: z.string(),
  quantity: numericString,
  remaining_quantity: numericString.nullable(),
})

const sourceRefHistoryItemSchema = z.object({
  source_ref: z.string(),
  created_at: z.iso.datetime({ offset: true }),
})

const listedDeliverySchema = z.object({
  id: z.string(),
  source_ref: z.string().nullable(),
  source_ref_history: z.array(sourceRefHistoryItemSchema),
  status: z.enum(['planned', 'received', 'cancelled']),
  expected_date: z.iso.date(),
  received_date: z.iso.date().nullable(),
  change_deadline: z.iso.date().nullable(),
  items: z.array(deliveryLotItemSchema),
})

export const readListedDeliveries = (
  pgSql: SqlOrTx,
  input: ListDeliveriesInput,
): ResultAsync<ReadonlyArray<ListedDelivery>, StockDomainError> =>
  ResultAsync.fromPromise(
    pgSql<Record<string, unknown>[]>`
      WITH delivery_lots AS (
        SELECT sl.delivery_id, sl.id AS stock_lot_id,
               sl.food_master_id, fm.name AS food_name,
               sl.quantity::text AS quantity,
               CASE WHEN d.status = 'received'
                 THEN COALESCE(SUM(sm.delta), 0)::text
                 ELSE NULL
               END AS remaining_quantity
        FROM deliveries d
        JOIN stock_lots sl ON sl.delivery_id = d.id
        JOIN food_masters fm ON fm.id = sl.food_master_id
        LEFT JOIN stock_movements sm ON sm.stock_lot_id = sl.id
        GROUP BY sl.delivery_id, sl.id, sl.food_master_id, fm.name,
                 sl.quantity, d.status
      ), delivery_source_ref_history AS (
        SELECT delivery_id,
               jsonb_agg(
                 jsonb_build_object(
                   'source_ref', source_ref,
                   'created_at', to_char(
                     created_at AT TIME ZONE 'UTC',
                     'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                   )
                 ) ORDER BY created_at, source_ref
               ) AS source_ref_history
        FROM delivery_source_refs
        GROUP BY delivery_id
      )
      SELECT d.id, d.source_ref,
             COALESCE(dsrh.source_ref_history, '[]'::jsonb) AS source_ref_history,
             d.status::text AS status,
             d.expected_date::text AS expected_date,
             d.received_date::text AS received_date,
             d.change_deadline::text AS change_deadline,
             COALESCE(
               jsonb_agg(
                 jsonb_build_object(
                   'food_master_id', dl.food_master_id,
                   'food_name', dl.food_name,
                   'stock_lot_id', dl.stock_lot_id,
                   'quantity', dl.quantity,
                   'remaining_quantity', dl.remaining_quantity
                 ) ORDER BY dl.food_name, dl.food_master_id, dl.stock_lot_id
               ) FILTER (WHERE dl.stock_lot_id IS NOT NULL),
               '[]'::jsonb
             ) AS items
      FROM deliveries d
      LEFT JOIN delivery_lots dl ON dl.delivery_id = d.id
      LEFT JOIN delivery_source_ref_history dsrh ON dsrh.delivery_id = d.id
      WHERE (${input.deliveryId ?? null}::text IS NULL
             OR d.id = ${input.deliveryId ?? null})
        AND (${input.sourceRef ?? null}::text IS NULL
             OR EXISTS (
               SELECT 1
               FROM delivery_source_refs dsr
               WHERE dsr.delivery_id = d.id
                 AND dsr.source_ref = ${input.sourceRef ?? null}
             ))
        AND (${input.status ?? null}::text IS NULL
             OR d.status::text = ${input.status ?? null})
      GROUP BY d.id, dsrh.source_ref_history
      ORDER BY COALESCE(d.received_date, d.expected_date) DESC, d.id DESC
      LIMIT ${input.limit}
    `,
    toStockError,
  ).andThen((rows) => {
    const parsed = parseRows(listedDeliverySchema, rows, 'list deliveries')
    if (parsed.isErr()) return errAsync(parsed.error)

    return okAsync(
      parsed.value.map((delivery) => ({
        id: delivery.id,
        sourceRef: delivery.source_ref,
        sourceRefHistory: delivery.source_ref_history.map((entry) => ({
          sourceRef: entry.source_ref,
          createdAt: entry.created_at,
        })),
        status: delivery.status,
        expectedDate: delivery.expected_date,
        receivedDate: delivery.received_date,
        changeDeadline: delivery.change_deadline,
        items: delivery.items.map((item) => ({
          foodMasterId: item.food_master_id,
          foodName: item.food_name,
          stockLotId: item.stock_lot_id,
          quantity: item.quantity,
          remainingQuantity: item.remaining_quantity,
        })),
      })),
    )
  })

export const createStockDeliveryReader =
  (pgSql: Sql) =>
  (
    input: ListDeliveriesInput,
  ): ResultAsync<ReadonlyArray<ListedDelivery>, StockDomainError> =>
    readListedDeliveries(pgSql, input)
