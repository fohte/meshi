import type { Result } from 'neverthrow'

import type { Sql } from '#db/index'
import type { FoodMasterDomainError } from '#domain/food-master/errors'
import type { IdGenerator } from '#domain/food-master/id'

// Runs `fn` inside a SAVEPOINT instead of `sql.begin()`'s own BEGIN/COMMIT,
// for callers where `sql` is already inside an outer transaction (per-test
// transactions in unit tests) — postgres-js rejects a nested BEGIN there.
export const runInSavepoint = <T>(
  sql: Sql,
  generateId: IdGenerator,
  fn: (tx: Sql) => Promise<Result<T, FoodMasterDomainError>>,
): Promise<Result<T, FoodMasterDomainError>> => {
  const savepoint = `fm_sp_${generateId('sp').replace(/[^A-Za-z0-9_]/g, '_')}`
  return sql.unsafe(`SAVEPOINT ${savepoint}`).then(() =>
    fn(sql)
      .then((result) =>
        sql.unsafe(`RELEASE SAVEPOINT ${savepoint}`).then(() => result),
      )
      .catch((caughtErr: unknown) =>
        sql.unsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`).then(() =>
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- re-propagating the original rejection reason (a real Error from postgres.js) without a throw statement; this file may not use throw/try.
          Promise.reject(caughtErr),
        ),
      ),
  )
}
