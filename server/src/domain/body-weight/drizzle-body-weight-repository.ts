import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { err, ok, type Result, ResultAsync } from 'neverthrow'

import type { Sql } from '#db/index'
import { getConstraintName, isUniqueViolation } from '#db/pg-error'
import { bodyWeights } from '#db/schema'
import type { BodyWeightRepository } from '#domain/body-weight/body-weight-repository'
import {
  BodyWeightDomainError,
  BodyWeightPersistenceError,
  DuplicateBodyWeightError,
} from '#domain/body-weight/errors'
import type { BodyWeight } from '#domain/body-weight/types'

const BODY_WEIGHT_CONSTRAINT =
  'body_weights_measured_date_measured_at_weight_kg_key'

const toBodyWeight = (row: typeof bodyWeights.$inferSelect): BodyWeight => ({
  id: row.id,
  date: row.measuredDate,
  measuredAt: row.measuredAt,
  weightKg: Number(row.weightKg),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const createDrizzleBodyWeightRepository = (
  pgSql: Sql,
): BodyWeightRepository => {
  const db = drizzle(pgSql)

  const persistenceError = (
    message: string,
    caughtError: unknown,
  ): BodyWeightDomainError =>
    new BodyWeightPersistenceError(message, caughtError)

  return {
    create(input) {
      return ResultAsync.fromPromise(
        (async (): Promise<Result<BodyWeight, BodyWeightDomainError>> => {
          const [row] = await db
            .insert(bodyWeights)
            .values({
              id: input.id,
              measuredDate: input.date,
              measuredAt: input.measuredAt,
              weightKg: input.weightKg.toString(),
            })
            .onConflictDoUpdate({
              target: [
                bodyWeights.measuredDate,
                bodyWeights.measuredAt,
                bodyWeights.weightKg,
              ],
              set: { measuredDate: sql`excluded.measured_date` },
            })
            .returning()
          if (row === undefined) {
            return err(
              new BodyWeightPersistenceError(
                'body_weights upsert returned no rows',
              ),
            )
          }
          return ok(toBodyWeight(row))
        })(),
        (caughtError) =>
          persistenceError('failed to record body_weight', caughtError),
      ).andThen((result) => result)
    },
    list(from, to) {
      return ResultAsync.fromPromise(
        db
          .select()
          .from(bodyWeights)
          .where(
            and(
              gte(bodyWeights.measuredDate, from),
              lte(bodyWeights.measuredDate, to),
            ),
          )
          .orderBy(
            desc(bodyWeights.measuredDate),
            sql`${bodyWeights.measuredAt} DESC NULLS LAST`,
            desc(bodyWeights.createdAt),
          ),
        (caughtError) =>
          persistenceError('failed to list body_weights', caughtError),
      ).map((rows) => rows.map(toBodyWeight))
    },
    findById(id) {
      return ResultAsync.fromPromise(
        db.select().from(bodyWeights).where(eq(bodyWeights.id, id)).limit(1),
        (caughtError) =>
          persistenceError('failed to load body_weight', caughtError),
      ).map((rows) => {
        const [row] = rows
        return row === undefined ? null : toBodyWeight(row)
      })
    },
    update(id, input) {
      return ResultAsync.fromPromise(
        db.transaction((session) =>
          session
            .update(bodyWeights)
            .set({
              measuredDate: input.date,
              measuredAt: input.measuredAt,
              weightKg: input.weightKg.toString(),
              updatedAt: new Date(),
            })
            .where(eq(bodyWeights.id, id))
            .returning(),
        ),
        (caughtError) => {
          if (
            isUniqueViolation(caughtError) &&
            getConstraintName(caughtError) === BODY_WEIGHT_CONSTRAINT
          ) {
            return new DuplicateBodyWeightError(caughtError)
          }
          return persistenceError('failed to update body_weight', caughtError)
        },
      ).map((rows) => {
        const [row] = rows
        return row === undefined ? null : toBodyWeight(row)
      })
    },
    delete(id) {
      return ResultAsync.fromPromise(
        db
          .delete(bodyWeights)
          .where(eq(bodyWeights.id, id))
          .returning({ id: bodyWeights.id }),
        (caughtError) =>
          persistenceError('failed to delete body_weight', caughtError),
      ).map((rows) => rows.length > 0)
    },
  }
}
