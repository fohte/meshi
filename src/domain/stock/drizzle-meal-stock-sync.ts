import { asc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { err, ok, type Result } from 'neverthrow'
import { z } from 'zod'

import { foodMasters, stockItems, stockLots, stockMovements } from '#db/schema'
import type { IdGenerator } from '#domain/food-master/id'
import { StockDomainError } from '#domain/stock/errors'
import {
  firstRow,
  numericString,
  parseRows,
} from '#domain/stock/stock-repository-utils'

type Db = ReturnType<typeof drizzle>
type MealStockSyncSession = Parameters<Parameters<Db['transaction']>[0]>[0]

const lockRowSchema = z.object({ id: z.string() })
const numericTextSchema = z.string().regex(/^-?\d+(?:\.\d+)?$/)
const allocationRowSchema = z.object({
  stock_lot_id: z.string(),
  consumed: numericTextSchema,
})
const shortfallRowSchema = z.object({ shortfall: numericTextSchema })

interface MealStockSyncInput {
  readonly mealLogId: string
  readonly foodMasterId: string
  readonly quantity: number
}

export const consumeStockForMealLog = async (
  session: MealStockSyncSession,
  input: MealStockSyncInput,
  generateId: IdGenerator,
): Promise<Result<number | null, StockDomainError>> => {
  const foodMasterRows = parseRows(
    lockRowSchema,
    await session
      .select({ id: foodMasters.id })
      .from(foodMasters)
      .where(eq(foodMasters.id, input.foodMasterId))
      .for('no key update'),
    'lock food_master for meal stock sync',
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

  const stockItemRows = parseRows(
    lockRowSchema,
    await session
      .select({ id: stockItems.foodMasterId })
      .from(stockItems)
      .where(eq(stockItems.foodMasterId, input.foodMasterId))
      .for('update'),
    'lock stock_item for meal stock sync',
  )
  if (stockItemRows.isErr()) return err(stockItemRows.error)
  if (stockItemRows.value.length === 0) return ok(null)

  const lockedLots = parseRows(
    lockRowSchema,
    await session
      .select({ id: stockLots.id })
      .from(stockLots)
      .where(eq(stockLots.foodMasterId, input.foodMasterId))
      .orderBy(
        sql`${stockLots.receivedDate} ASC NULLS FIRST`,
        asc(stockLots.createdAt),
        asc(stockLots.id),
      )
      .for('update'),
    'lock stock_lots for meal stock sync',
  )
  if (lockedLots.isErr()) return err(lockedLots.error)

  const allocationRows = parseRows(
    allocationRowSchema,
    await session.execute(sql`
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
               GREATEST(${input.quantity}::numeric - remaining_before, 0)
             )::text AS consumed
      FROM ordered_lots
      WHERE LEAST(
        remaining,
        GREATEST(${input.quantity}::numeric - remaining_before, 0)
      ) > 0
      ORDER BY received_date ASC NULLS FIRST, created_at ASC, stock_lot_id ASC
    `),
    'allocate meal stock consumption',
  )
  if (allocationRows.isErr()) return err(allocationRows.error)

  const shortfallRows = parseRows(
    shortfallRowSchema,
    await session.execute(sql`
      WITH lot_balances AS (
        SELECT COALESCE(SUM(sm.delta), 0)::numeric AS remaining
        FROM stock_lots sl
        LEFT JOIN stock_movements sm ON sm.stock_lot_id = sl.id
        WHERE sl.food_master_id = ${input.foodMasterId}
        GROUP BY sl.id
      )
      SELECT GREATEST(
        ${input.quantity}::numeric - COALESCE(SUM(GREATEST(remaining, 0)), 0),
        0
      )::text AS shortfall
      FROM lot_balances
    `),
    'calculate meal stock shortfall',
  )
  if (shortfallRows.isErr()) return err(shortfallRows.error)
  const shortfallRow = firstRow(
    shortfallRows.value,
    'calculate meal stock shortfall',
  )
  if (shortfallRow.isErr()) return err(shortfallRow.error)
  const shortfall = numericString.safeParse(shortfallRow.value.shortfall)
  if (!shortfall.success) {
    return err(
      new StockDomainError(
        'persistence_failed',
        'meal stock sync returned an invalid shortfall',
      ),
    )
  }

  if (allocationRows.value.length > 0) {
    await session.insert(stockMovements).values(
      allocationRows.value.map((allocation) => ({
        id: generateId('stm'),
        stockLotId: allocation.stock_lot_id,
        delta: `-${allocation.consumed}`,
        reason: 'meal',
        mealLogId: input.mealLogId,
      })),
    )
  }

  return ok(shortfall.data)
}

export const clearMealStockMovements = async (
  session: MealStockSyncSession,
  mealLogId: string,
): Promise<void> => {
  await session
    .delete(stockMovements)
    .where(eq(stockMovements.mealLogId, mealLogId))
}
