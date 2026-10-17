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
const stockTotalRowSchema = z.object({ quantity: z.string() })
const stockLotBalanceRowSchema = z.object({
  stock_lot_id: z.string(),
  remaining: z.string(),
})
const numericDistributionRowSchema = z.object({
  consumed: z.string(),
  remaining: z.string(),
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
      const stockItemRows = parseRows(
        foodMasterRowSchema,
        await tx<Record<string, unknown>[]>`
          SELECT fm.id
          FROM food_masters fm
          JOIN stock_items si ON si.food_master_id = fm.id
          WHERE fm.id = ${input.foodMasterId}
          FOR UPDATE OF si
        `,
        'load stock_item for count',
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

      const totalRows = parseRows(
        stockTotalRowSchema,
        await tx<Record<string, unknown>[]>`
          SELECT COALESCE(SUM(sm.delta), 0)::text AS quantity
          FROM stock_lots sl
          LEFT JOIN stock_movements sm ON sm.stock_lot_id = sl.id
          WHERE sl.food_master_id = ${input.foodMasterId}
        `,
        'sum stock movements',
      )
      if (totalRows.isErr()) return err(totalRows.error)
      const totalRow = firstRow(totalRows.value, 'sum stock movements')
      if (totalRow.isErr()) return err(totalRow.error)

      const lotRows = parseRows(
        stockLotBalanceRowSchema,
        await tx<Record<string, unknown>[]>`
          SELECT sl.id AS stock_lot_id,
                 COALESCE(SUM(sm.delta), 0)::text AS remaining
          FROM stock_lots sl
          LEFT JOIN stock_movements sm ON sm.stock_lot_id = sl.id
          WHERE sl.food_master_id = ${input.foodMasterId}
          GROUP BY sl.id, sl.received_date, sl.created_at
          ORDER BY sl.received_date ASC NULLS FIRST, sl.created_at ASC, sl.id ASC
        `,
        'load stock_lot balances',
      )
      if (lotRows.isErr()) return err(lotRows.error)

      const differenceRows = parseRows(
        z.object({ difference: z.string() }),
        await tx<Record<string, unknown>[]>`
          SELECT (${input.quantity}::numeric - ${totalRow.value.quantity}::numeric)::text
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
        const amountRows = parseRows(
          z.object({ amount: z.string() }),
          await tx<Record<string, unknown>[]>`
            SELECT (-${difference}::numeric)::text AS amount
          `,
          'calculate stock reduction',
        )
        if (amountRows.isErr()) return err(amountRows.error)
        const amountRow = firstRow(
          amountRows.value,
          'calculate stock reduction',
        )
        if (amountRow.isErr()) return err(amountRow.error)
        let remainingToRemove = amountRow.value.amount

        for (const lot of lotRows.value) {
          if (!isPositiveNumeric(remainingToRemove)) break
          if (!isPositiveNumeric(lot.remaining)) continue
          const distributionRows = parseRows(
            numericDistributionRowSchema,
            await tx<Record<string, unknown>[]>`
              SELECT
                LEAST(
                  ${remainingToRemove}::numeric,
                  ${lot.remaining}::numeric
                )::text AS consumed,
                GREATEST(
                  ${remainingToRemove}::numeric - ${lot.remaining}::numeric,
                  0
                )::text AS remaining
            `,
            'allocate stock count reduction',
          )
          if (distributionRows.isErr()) return err(distributionRows.error)
          const distribution = firstRow(
            distributionRows.value,
            'allocate stock count reduction',
          )
          if (distribution.isErr()) return err(distribution.error)
          if (isPositiveNumeric(distribution.value.consumed)) {
            plannedMovements.push({
              stockLotId: lot.stock_lot_id,
              delta: `-${distribution.value.consumed}`,
            })
          }
          remainingToRemove = distribution.value.remaining
        }
        if (isPositiveNumeric(remainingToRemove)) {
          return err(
            new StockDomainError(
              'persistence_failed',
              'stock count reduction exceeded the available lot balances',
            ),
          )
        }
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

      const previousQuantity = numericString.safeParse(totalRow.value.quantity)
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
        remainingQuantity: input.quantity,
      } satisfies StockCountResult)
    })
}
