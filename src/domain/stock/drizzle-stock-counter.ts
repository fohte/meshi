import { err, ok } from 'neverthrow'
import { z } from 'zod'

import type { Sql } from '#db/index'
import type { IdGenerator } from '#domain/food-master/id'
import { StockDomainError } from '#domain/stock/errors'
import {
  createStockWriteRunner,
  firstRow,
  isNegativeNumeric,
  isPositiveNumeric,
  numericString,
  parseRows,
} from '#domain/stock/stock-repository-utils'
import type { CountStockInput, StockCountResult } from '#domain/stock/types'

const foodMasterRowSchema = z.object({ id: z.string() })
const stockLotLockRowSchema = z.object({ id: z.string() })
const stockLotBalanceRowSchema = z.object({
  stock_lot_id: z.string(),
  remaining: z.string(),
  total_quantity: z.string(),
})
const stockLotAllocationRowSchema = z.object({
  stock_lot_id: z.string(),
  consumed: z.string(),
})
const eatByRowSchema = z.object({ eat_by: z.string().nullable() })

export const createStockCounter = (
  pgSql: Sql,
  generateId: IdGenerator,
  wrapInTransaction: boolean,
) => {
  const runWrite = createStockWriteRunner(pgSql, wrapInTransaction)

  return (input: CountStockInput) =>
    runWrite(async (tx) => {
      const foodMasterRows = parseRows(
        foodMasterRowSchema,
        await tx<Record<string, unknown>[]>`
          SELECT id FROM food_masters
          WHERE id = ${input.foodMasterId}
          FOR UPDATE
        `,
        'lock food_master for count',
      )
      if (foodMasterRows.isErr()) return err(foodMasterRows.error)
      if (foodMasterRows.value.length === 0) {
        return err(
          new StockDomainError(
            'stock_item_not_found',
            `food_master is not a stock_item: ${input.foodMasterId}`,
            { foodMasterId: input.foodMasterId },
          ),
        )
      }

      const stockItemRows = parseRows(
        foodMasterRowSchema,
        await tx<Record<string, unknown>[]>`
          SELECT food_master_id AS id FROM stock_items
          WHERE food_master_id = ${input.foodMasterId}
          FOR UPDATE
        `,
        'lock stock_item for count',
      )
      if (stockItemRows.isErr()) return err(stockItemRows.error)
      if (stockItemRows.value.length === 0) {
        return err(
          new StockDomainError(
            'stock_item_not_found',
            `food_master is not a stock_item: ${input.foodMasterId}`,
            { foodMasterId: input.foodMasterId },
          ),
        )
      }

      const lockedLots = parseRows(
        stockLotLockRowSchema,
        await tx<Record<string, unknown>[]>`
          SELECT id FROM stock_lots
          WHERE food_master_id = ${input.foodMasterId}
          ORDER BY received_date ASC NULLS FIRST, created_at ASC, id ASC
          FOR UPDATE
        `,
        'lock stock_lots for count',
      )
      if (lockedLots.isErr()) return err(lockedLots.error)

      const lotRows = parseRows(
        stockLotBalanceRowSchema,
        await tx<Record<string, unknown>[]>`
          WITH lot_balances AS (
            SELECT sl.id AS stock_lot_id, sl.received_date, sl.created_at,
                   COALESCE(SUM(sm.delta), 0)::numeric AS remaining
            FROM stock_lots sl
            LEFT JOIN stock_movements sm ON sm.stock_lot_id = sl.id
            WHERE sl.food_master_id = ${input.foodMasterId}
            GROUP BY sl.id, sl.received_date, sl.created_at
          )
          SELECT stock_lot_id, remaining::text AS remaining,
                 COALESCE(SUM(remaining) OVER (), 0)::text AS total_quantity
          FROM lot_balances
          ORDER BY received_date ASC NULLS FIRST, created_at ASC, stock_lot_id ASC
        `,
        'load stock_lot balances',
      )
      if (lotRows.isErr()) return err(lotRows.error)
      const previousQuantityValue = lotRows.value[0]?.total_quantity ?? '0'

      const differenceRows = parseRows(
        z.object({ difference: z.string() }),
        await tx<Record<string, unknown>[]>`
          SELECT (${input.quantity}::numeric - ${previousQuantityValue}::numeric)::text
            AS difference
        `,
        'calculate stock count difference',
      )
      if (differenceRows.isErr()) return err(differenceRows.error)
      const differenceRow = firstRow(
        differenceRows.value,
        'calculate stock count difference',
      )
      if (differenceRow.isErr()) return err(differenceRow.error)
      const difference = differenceRow.value.difference

      const plannedMovements: Array<{ stockLotId: string; delta: string }> = []
      let newLot:
        | {
            readonly id: string
            readonly quantity: string
            readonly receivedDate: string | null
            readonly bestBefore: string | null
            readonly eatBy: string | null
          }
        | undefined

      if (isPositiveNumeric(difference)) {
        const eatByRows = parseRows(
          eatByRowSchema,
          await tx<Record<string, unknown>[]>`
            SELECT CASE
              WHEN ${input.receivedDate ?? null}::date IS NULL
                OR (
                  SELECT eat_within_days FROM stock_items
                  WHERE food_master_id = ${input.foodMasterId}
                ) IS NULL
              THEN NULL
              ELSE (
                ${input.receivedDate ?? null}::date + (
                  SELECT eat_within_days FROM stock_items
                  WHERE food_master_id = ${input.foodMasterId}
                )
              )::text
            END AS eat_by
          `,
          'calculate stock_lot eat_by',
        )
        if (eatByRows.isErr()) return err(eatByRows.error)
        const eatByRow = firstRow(eatByRows.value, 'calculate stock_lot eat_by')
        if (eatByRow.isErr()) return err(eatByRow.error)
        newLot = {
          id: generateId('stl'),
          quantity: difference,
          receivedDate: input.receivedDate ?? null,
          bestBefore: input.bestBefore ?? null,
          eatBy: eatByRow.value.eat_by,
        }
      } else if (isNegativeNumeric(difference)) {
        const allocationRows = parseRows(
          stockLotAllocationRowSchema,
          await tx<Record<string, unknown>[]>`
            WITH lot_balances AS (
              SELECT sl.id AS stock_lot_id, sl.received_date, sl.created_at,
                     COALESCE(SUM(sm.delta), 0)::numeric AS remaining
              FROM stock_lots sl
              LEFT JOIN stock_movements sm ON sm.stock_lot_id = sl.id
              WHERE sl.food_master_id = ${input.foodMasterId}
              GROUP BY sl.id, sl.received_date, sl.created_at
            ), ordered_lots AS (
              SELECT *, COALESCE(
                SUM(remaining) OVER (
                  ORDER BY received_date ASC NULLS FIRST, created_at ASC,
                           stock_lot_id ASC
                  ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                ),
                0
              ) AS remaining_before
              FROM lot_balances
              WHERE remaining > 0
            )
            SELECT stock_lot_id,
                   LEAST(
                     remaining,
                     GREATEST(-${difference}::numeric - remaining_before, 0)
                   )::text AS consumed
            FROM ordered_lots
            WHERE LEAST(
              remaining,
              GREATEST(-${difference}::numeric - remaining_before, 0)
            ) > 0
            ORDER BY received_date ASC NULLS FIRST, created_at ASC, stock_lot_id ASC
          `,
          'allocate stock count reduction',
        )
        if (allocationRows.isErr()) return err(allocationRows.error)
        plannedMovements.push(
          ...allocationRows.value.map((lot) => ({
            stockLotId: lot.stock_lot_id,
            delta: `-${lot.consumed}`,
          })),
        )
      }

      if (newLot !== undefined) {
        await tx`
          INSERT INTO stock_lots (
            id, food_master_id, quantity, received_date, best_before, eat_by
          ) VALUES (
            ${newLot.id}, ${input.foodMasterId}, ${newLot.quantity}::numeric,
            ${newLot.receivedDate}::date, ${newLot.bestBefore}::date,
            ${newLot.eatBy}::date
          )
        `
        plannedMovements.push({
          stockLotId: newLot.id,
          delta: newLot.quantity,
        })
      }
      for (const movement of plannedMovements) {
        await tx`
          INSERT INTO stock_movements (id, stock_lot_id, delta, reason)
          VALUES (
            ${generateId('stm')}, ${movement.stockLotId},
            ${movement.delta}::numeric, 'count'
          )
        `
      }

      const previousQuantity = numericString.safeParse(previousQuantityValue)
      const parsedDifference = numericString.safeParse(difference)
      if (!previousQuantity.success || !parsedDifference.success) {
        return err(
          new StockDomainError(
            'persistence_failed',
            'stock count returned an invalid numeric value',
          ),
        )
      }
      return ok({
        foodMasterId: input.foodMasterId,
        previousQuantity: previousQuantity.data,
        countedQuantity: input.quantity,
        difference: parsedDifference.data,
      } satisfies StockCountResult)
    })
}
