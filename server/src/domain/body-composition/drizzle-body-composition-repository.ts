import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { err, ok, type Result, ResultAsync } from 'neverthrow'

import type { Sql } from '#db/index'
import { getConstraintName, isUniqueViolation } from '#db/pg-error'
import { bodyCompositions } from '#db/schema'
import type { BodyCompositionRepository } from '#domain/body-composition/body-composition-repository'
import {
  BodyCompositionDomainError,
  BodyCompositionPersistenceError,
  DuplicateBodyCompositionError,
} from '#domain/body-composition/errors'
import type { BodyComposition } from '#domain/body-composition/types'

const BODY_COMPOSITION_CONSTRAINT = 'body_compositions_measurement_key'

const toBodyComposition = (
  row: typeof bodyCompositions.$inferSelect,
): BodyComposition => ({
  id: row.id,
  date: row.measuredDate,
  measuredAt: row.measuredAt,
  device: row.device,
  bodyFatPercent:
    row.bodyFatPercent === null ? null : Number(row.bodyFatPercent),
  muscleMassKg: row.muscleMassKg === null ? null : Number(row.muscleMassKg),
  skeletalMusclePercent:
    row.skeletalMusclePercent === null
      ? null
      : Number(row.skeletalMusclePercent),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const asNumeric = (value: number | null): string | null =>
  value === null ? null : value.toString()

export const createDrizzleBodyCompositionRepository = (
  pgSql: Sql,
): BodyCompositionRepository => {
  const db = drizzle(pgSql)

  const persistenceError = (
    message: string,
    caughtError: unknown,
  ): BodyCompositionDomainError =>
    new BodyCompositionPersistenceError(message, caughtError)

  return {
    create(input) {
      return ResultAsync.fromPromise(
        (async (): Promise<
          Result<BodyComposition, BodyCompositionDomainError>
        > => {
          const [row] = await db
            .insert(bodyCompositions)
            .values({
              id: input.id,
              measuredDate: input.date,
              measuredAt: input.measuredAt,
              device: input.device,
              bodyFatPercent: asNumeric(input.bodyFatPercent),
              muscleMassKg: asNumeric(input.muscleMassKg),
              skeletalMusclePercent: asNumeric(input.skeletalMusclePercent),
            })
            .onConflictDoUpdate({
              target: [
                bodyCompositions.measuredDate,
                bodyCompositions.measuredAt,
                bodyCompositions.device,
                bodyCompositions.bodyFatPercent,
                bodyCompositions.muscleMassKg,
                bodyCompositions.skeletalMusclePercent,
              ],
              set: { measuredDate: sql`excluded.measured_date` },
            })
            .returning()
          if (row === undefined) {
            return err(
              new BodyCompositionPersistenceError(
                'body_compositions upsert returned no rows',
              ),
            )
          }
          return ok(toBodyComposition(row))
        })(),
        (caughtError) =>
          persistenceError('failed to record body_composition', caughtError),
      ).andThen((result) => result)
    },
    list(from, to) {
      return ResultAsync.fromPromise(
        db
          .select()
          .from(bodyCompositions)
          .where(
            and(
              gte(bodyCompositions.measuredDate, from),
              lte(bodyCompositions.measuredDate, to),
            ),
          )
          .orderBy(
            desc(bodyCompositions.measuredDate),
            sql`${bodyCompositions.measuredAt} DESC NULLS LAST`,
            desc(bodyCompositions.createdAt),
          ),
        (caughtError) =>
          persistenceError('failed to list body_compositions', caughtError),
      ).map((rows) => rows.map(toBodyComposition))
    },
    update(id, resolveUpdate) {
      return ResultAsync.fromPromise(
        db.transaction(async (session) => {
          const [existing] = await session
            .select()
            .from(bodyCompositions)
            .where(eq(bodyCompositions.id, id))
            .for('update')
            .limit(1)
          if (existing === undefined) return ok(null)

          const changes = resolveUpdate(toBodyComposition(existing))
          if (changes.isErr()) return err(changes.error)

          const [updated] = await session
            .update(bodyCompositions)
            .set({
              measuredDate: changes.value.date,
              measuredAt: changes.value.measuredAt,
              device: changes.value.device,
              bodyFatPercent: asNumeric(changes.value.bodyFatPercent),
              muscleMassKg: asNumeric(changes.value.muscleMassKg),
              skeletalMusclePercent: asNumeric(
                changes.value.skeletalMusclePercent,
              ),
              updatedAt: new Date(),
            })
            .where(eq(bodyCompositions.id, id))
            .returning()
          return updated === undefined
            ? ok(null)
            : ok(toBodyComposition(updated))
        }),
        (caughtError) => {
          if (
            isUniqueViolation(caughtError) &&
            getConstraintName(caughtError) === BODY_COMPOSITION_CONSTRAINT
          ) {
            return new DuplicateBodyCompositionError(caughtError)
          }
          return persistenceError(
            'failed to update body_composition',
            caughtError,
          )
        },
      ).andThen((result) => result)
    },
    delete(id) {
      return ResultAsync.fromPromise(
        db
          .delete(bodyCompositions)
          .where(eq(bodyCompositions.id, id))
          .returning({ id: bodyCompositions.id }),
        (caughtError) =>
          persistenceError('failed to delete body_composition', caughtError),
      ).map((rows) => rows.length > 0)
    },
  }
}
