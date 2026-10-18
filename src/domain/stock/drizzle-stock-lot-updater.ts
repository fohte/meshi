import { err, ok } from 'neverthrow'
import { z } from 'zod'

import type { Sql } from '#db/index'
import { StockDomainError } from '#domain/stock/errors'
import {
  createStockWriteRunner,
  parseRows,
} from '#domain/stock/stock-repository-utils'
import type { UpdateStockLotInput } from '#domain/stock/types'

const stockLotDatesRowSchema = z.object({
  id: z.string(),
  best_before: z.iso.date().nullable(),
  eat_by: z.iso.date().nullable(),
})

export const createStockLotUpdater = (
  pgSql: Sql,
  wrapInTransaction: boolean,
) => {
  const runWrite = createStockWriteRunner(pgSql, wrapInTransaction)

  return (input: UpdateStockLotInput) =>
    runWrite(async (tx) => {
      const rows = parseRows(
        stockLotDatesRowSchema,
        await tx<Record<string, unknown>[]>`
          UPDATE stock_lots SET
            best_before = CASE
              WHEN ${input.bestBefore !== undefined}
                THEN ${input.bestBefore ?? null}::date
              ELSE best_before
            END,
            eat_by = CASE
              WHEN ${input.eatBy !== undefined}
                THEN ${input.eatBy ?? null}::date
              ELSE eat_by
            END
          WHERE id = ${input.stockLotId}
          RETURNING id, best_before::text AS best_before,
                    eat_by::text AS eat_by
        `,
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

      return ok({
        id: row.id,
        bestBefore: row.best_before,
        eatBy: row.eat_by,
      })
    })
}
