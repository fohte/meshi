import { err, ok, type Result, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { Sql, SqlOrTx } from '#db/index'
import { StockDomainError } from '#domain/stock/errors'

export const numericString = z.string().transform(Number).pipe(z.number())

const errorMessage = (caughtError: unknown): string =>
  caughtError instanceof Error ? caughtError.message : String(caughtError)

export const toStockError = (caughtError: unknown): StockDomainError =>
  caughtError instanceof StockDomainError
    ? caughtError
    : new StockDomainError(
        'persistence_failed',
        errorMessage(caughtError),
        {},
        caughtError,
      )

export const parseRows = <T>(
  schema: z.ZodType<T>,
  rows: ReadonlyArray<unknown>,
  queryName: string,
): Result<T[], StockDomainError> => {
  const parsed = z.array(schema).safeParse(rows)
  return parsed.success
    ? ok(parsed.data)
    : err(
        new StockDomainError(
          'persistence_failed',
          `${queryName} returned invalid rows: ${parsed.error.message}`,
        ),
      )
}

export const firstRow = <T>(
  rows: ReadonlyArray<T>,
  queryName: string,
): Result<T, StockDomainError> => {
  const row = rows[0]
  return row === undefined
    ? err(
        new StockDomainError(
          'persistence_failed',
          `${queryName} returned no rows`,
        ),
      )
    : ok(row)
}

export const isPositiveNumeric = (value: string): boolean =>
  !value.startsWith('-') && /[1-9]/.test(value)

export const isNegativeNumeric = (value: string): boolean =>
  value.startsWith('-') && /[1-9]/.test(value)

export const createStockWriteRunner =
  (pgSql: Sql, wrapInTransaction: boolean) =>
  <T>(
    work: (tx: SqlOrTx) => Promise<Result<T, StockDomainError>>,
  ): ResultAsync<T, StockDomainError> => {
    const transactionWork = async (
      tx: SqlOrTx,
    ): Promise<Result<T, StockDomainError>> => {
      const result = await work(tx)
      if (result.isErr()) {
        // postgres-js commits when a transaction callback resolves with an
        // Err value, so reject typed domain errors to roll back the writes.
        return Promise.reject(result.error)
      }
      return result
    }
    const promise = wrapInTransaction
      ? pgSql.begin((tx) => transactionWork(tx))
      : transactionWork(pgSql)
    return ResultAsync.fromPromise(promise, toStockError).andThen(
      (result) => result,
    )
  }
