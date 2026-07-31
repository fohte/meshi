import { and, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { err, ok, type Result, ResultAsync } from 'neverthrow'

import type { Sql } from '#db/index'
import { mealSkips } from '#db/schema'
import type { MealSkipDomainError } from '#domain/meal-skip/errors'
import { MealSkipPersistenceError } from '#domain/meal-skip/errors'
import type {
  InsertMealSkipInput,
  MealSkipRepository,
} from '#domain/meal-skip/meal-skip-repository'
import type { MealSkipRow, MealType } from '#domain/meal-skip/types'

type Db = ReturnType<typeof drizzle>

export const createDrizzleMealSkipRepository = (
  pgSql: Sql,
): MealSkipRepository => {
  const db: Db = drizzle(pgSql)

  return {
    recordSkip: (
      input: InsertMealSkipInput,
    ): ResultAsync<MealSkipRow, MealSkipDomainError> =>
      ResultAsync.fromPromise(
        (async (): Promise<Result<MealSkipRow, MealSkipDomainError>> => {
          const [row] = await db
            .insert(mealSkips)
            .values({
              id: input.id,
              date: input.date,
              mealType: input.mealType,
            })
            .onConflictDoUpdate({
              target: [mealSkips.date, mealSkips.mealType],
              // No-op set (re-affirms the value that caused the conflict) —
              // exists only so .returning() gives back the pre-existing row
              // (with its original id) on a repeat call.
              set: { date: sql`excluded.date` },
            })
            .returning()
          if (row === undefined) {
            return err(
              new MealSkipPersistenceError(
                'meal_skips upsert returned no rows',
              ),
            )
          }
          return ok(row)
        })(),
        (caughtErr) =>
          new MealSkipPersistenceError('failed to upsert meal_skip', caughtErr),
      ).andThen((result) => result),

    cancelSkip: (
      date: string,
      mealType: MealType,
    ): ResultAsync<boolean, MealSkipDomainError> =>
      ResultAsync.fromPromise(
        db
          .delete(mealSkips)
          .where(
            and(eq(mealSkips.date, date), eq(mealSkips.mealType, mealType)),
          )
          .returning({ id: mealSkips.id }),
        (caughtErr) =>
          new MealSkipPersistenceError('failed to delete meal_skip', caughtErr),
      ).map((deleted) => deleted.length > 0),

    findSkipsForDate: (
      date: string,
    ): ResultAsync<ReadonlyArray<MealSkipRow>, MealSkipDomainError> =>
      ResultAsync.fromPromise(
        db.select().from(mealSkips).where(eq(mealSkips.date, date)),
        (caughtErr) =>
          new MealSkipPersistenceError('failed to load meal_skips', caughtErr),
      ),
  }
}
