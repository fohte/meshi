import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { err, ok, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { Sql } from '#db/index'
import { stockLots } from '#db/schema'
import { StockDomainError } from '#domain/stock/errors'
import { parseRows, toStockError } from '#domain/stock/stock-repository-utils'
import type { UpdatedStockLot, UpdateStockLotInput } from '#domain/stock/types'

type Db = ReturnType<typeof drizzle>
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0]
type DbSession = Db | Transaction

const updatedStockLotRowSchema = z.object({
  id: z.string(),
  bestBefore: z.iso.date().nullable(),
  eatBy: z.iso.date().nullable(),
})

export const createStockLotUpdater = (
  pgSql: Sql,
  wrapInTransaction: boolean,
) => {
  const db: Db = drizzle(pgSql)

  return (input: UpdateStockLotInput) => {
    const update = async (session: DbSession) => {
      const rawRows = await session
        .update(stockLots)
        .set({
          ...(input.bestBefore === undefined
            ? {}
            : { bestBefore: input.bestBefore }),
          ...(input.eatBy === undefined ? {} : { eatBy: input.eatBy }),
        })
        .where(eq(stockLots.id, input.stockLotId))
        .returning({
          id: stockLots.id,
          bestBefore: stockLots.bestBefore,
          eatBy: stockLots.eatBy,
        })
      const rows = parseRows(
        updatedStockLotRowSchema,
        rawRows,
        'update stock_lot dates',
      )
      if (rows.isErr()) return err(rows.error)

      const row = rows.value[0]
      if (row === undefined) {
        return err(
          new StockDomainError(
            'stock_lot_not_found',
            `stock_lot not found: ${input.stockLotId}`,
            { stockLotId: input.stockLotId },
          ),
        )
      }

      return ok<UpdatedStockLot, StockDomainError>(row)
    }

    const transactionWork = async (session: DbSession) => {
      const result = await update(session)
      if (result.isErr()) return Promise.reject(result.error)
      return result
    }

    const promise = wrapInTransaction
      ? db.transaction((tx) => transactionWork(tx))
      : transactionWork(db)
    return ResultAsync.fromPromise(promise, toStockError).andThen(
      (result) => result,
    )
  }
}
