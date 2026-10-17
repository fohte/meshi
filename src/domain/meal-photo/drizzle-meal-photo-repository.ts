import { and, asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { err, errAsync, ok, okAsync, Result, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { Sql } from '#db/index'
import { mealPhotos } from '#db/schema'
import { MEAL_TYPES, type MealType } from '#domain/meal-log/types'
import { MealPhotoPersistenceError } from '#domain/meal-photo/errors'
import type {
  InsertMealPhotoInput,
  MealPhotoRepository,
} from '#domain/meal-photo/meal-photo-repository'
import {
  MEAL_PHOTO_CONTENT_TYPES,
  type MealPhotoRow,
} from '#domain/meal-photo/types'
import { type JstDate, jstDateSchema } from '#lib/jst-date'

type Db = ReturnType<typeof drizzle>

const dbRowSchema = z.object({
  id: z.string(),
  eatenDate: jstDateSchema,
  mealType: z.enum(MEAL_TYPES),
  objectKey: z.string(),
  contentType: z.enum(MEAL_PHOTO_CONTENT_TYPES),
  createdAt: z.date(),
})

const toDomain = (
  row: unknown,
): Result<MealPhotoRow, MealPhotoPersistenceError> => {
  const parsed = dbRowSchema.safeParse(row)
  if (!parsed.success) {
    return err(
      new MealPhotoPersistenceError(
        'meal_photos query returned invalid data',
        parsed.error,
      ),
    )
  }
  return ok({
    id: parsed.data.id,
    date: parsed.data.eatenDate,
    mealType: parsed.data.mealType,
    objectKey: parsed.data.objectKey,
    contentType: parsed.data.contentType,
    createdAt: parsed.data.createdAt,
  })
}

const toDomainRows = (
  rows: unknown,
): Result<ReadonlyArray<MealPhotoRow>, MealPhotoPersistenceError> => {
  const parsed = z.array(z.unknown()).safeParse(rows)
  if (!parsed.success) {
    return err(
      new MealPhotoPersistenceError(
        'meal_photos query returned invalid data',
        parsed.error,
      ),
    )
  }
  return Result.combine(parsed.data.map(toDomain))
}

export const createDrizzleMealPhotoRepository = (
  pgSql: Sql,
): MealPhotoRepository => {
  const db: Db = drizzle(pgSql)

  return {
    insert(input: InsertMealPhotoInput) {
      return ResultAsync.fromPromise(
        db
          .insert(mealPhotos)
          .values({
            id: input.id,
            eatenDate: input.date,
            mealType: input.mealType,
            objectKey: input.objectKey,
            contentType: input.contentType,
            ...(input.createdAt === undefined
              ? {}
              : { createdAt: input.createdAt }),
          })
          .returning(),
        (error) =>
          new MealPhotoPersistenceError('failed to insert meal_photo', error),
      ).andThen(([row]) =>
        row === undefined
          ? errAsync(
              new MealPhotoPersistenceError(
                'meal_photos insert returned no rows',
              ),
            )
          : toDomain(row),
      )
    },
    findForMeal(date: JstDate, mealType: MealType) {
      return ResultAsync.fromPromise(
        db
          .select()
          .from(mealPhotos)
          .where(
            and(
              eq(mealPhotos.eatenDate, date),
              eq(mealPhotos.mealType, mealType),
            ),
          )
          .orderBy(asc(mealPhotos.createdAt), asc(mealPhotos.id)),
        (error) =>
          new MealPhotoPersistenceError('failed to load meal_photos', error),
      ).andThen((rows) => toDomainRows(rows))
    },
    findById(id: string) {
      return ResultAsync.fromPromise(
        db.select().from(mealPhotos).where(eq(mealPhotos.id, id)).limit(1),
        (error) =>
          new MealPhotoPersistenceError('failed to load meal_photo', error),
      ).andThen(([row]) => (row === undefined ? okAsync(null) : toDomain(row)))
    },
    deleteById(id: string) {
      return ResultAsync.fromPromise(
        db.delete(mealPhotos).where(eq(mealPhotos.id, id)).returning(),
        (error) =>
          new MealPhotoPersistenceError('failed to delete meal_photo', error),
      ).andThen(([row]) => (row === undefined ? okAsync(null) : toDomain(row)))
    },
  }
}
