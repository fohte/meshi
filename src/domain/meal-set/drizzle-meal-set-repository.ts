import { asc, desc, eq, inArray, type SQL, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { err, ok, okAsync, type Result, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { Sql } from '#db/index'
import { numericValueSchema } from '#db/numeric-value-schema'
import { getConstraintName, isUniqueViolation } from '#db/pg-error'
import { foodMasters, mealSetItems, mealSets } from '#db/schema'
import {
  DuplicateMealSetNameError,
  type MealSetDomainError,
  MealSetFoodMasterNotFoundError,
  MealSetNotFoundError,
  MealSetPersistenceError,
} from '#domain/meal-set/errors'
import type {
  MealSetRepository,
  MealSetWrite,
} from '#domain/meal-set/meal-set-repository'
import type { MealSet, MealSetItem } from '#domain/meal-set/types'

type Db = ReturnType<typeof drizzle>
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0]
type DbSession = Db | Transaction

export interface DrizzleMealSetRepositoryOptions {
  readonly wrapInTransaction?: boolean
}

const mealSetRowsSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    createdAt: z.date(),
    foodMasterId: z.string(),
    foodName: z.string(),
    quantity: numericValueSchema.pipe(z.number().positive()),
  }),
)

const searchRowsSchema = z.array(
  z.object({
    id: z.string(),
    score: numericValueSchema,
  }),
)

const toMealSets = (
  rawRows: unknown,
): Result<ReadonlyArray<MealSet>, MealSetPersistenceError> => {
  const parsed = mealSetRowsSchema.safeParse(rawRows)
  if (!parsed.success) {
    return err(
      new MealSetPersistenceError(
        `meal_sets query returned invalid rows: ${parsed.error.message}`,
        parsed.error,
      ),
    )
  }

  const groups = new Map<string, MealSet>()
  for (const row of parsed.data) {
    const existing = groups.get(row.id)
    const item: MealSetItem = {
      foodMasterId: row.foodMasterId,
      foodName: row.foodName,
      quantity: row.quantity,
    }
    if (existing === undefined) {
      groups.set(row.id, {
        id: row.id,
        name: row.name,
        createdAt: row.createdAt,
        items: [item],
      })
    } else {
      groups.set(row.id, { ...existing, items: [...existing.items, item] })
    }
  }

  return ok(Array.from(groups.values()))
}

const selectMealSetRows = (session: DbSession, where?: SQL) =>
  session
    .select({
      id: mealSets.id,
      name: mealSets.name,
      createdAt: mealSets.createdAt,
      foodMasterId: mealSetItems.foodMasterId,
      foodName: foodMasters.name,
      quantity: mealSetItems.quantity,
    })
    .from(mealSets)
    .innerJoin(mealSetItems, eq(mealSetItems.mealSetId, mealSets.id))
    .innerJoin(foodMasters, eq(foodMasters.id, mealSetItems.foodMasterId))
    .where(where)
    .orderBy(asc(mealSets.name), asc(foodMasters.name), asc(foodMasters.id))

const findItems = async (
  session: DbSession,
  input: MealSetWrite,
): Promise<Result<ReadonlyArray<MealSetItem>, MealSetDomainError>> => {
  const foodRows = await session
    .select({ id: foodMasters.id, name: foodMasters.name })
    .from(foodMasters)
    .where(
      inArray(
        foodMasters.id,
        input.items.map((item) => item.foodMasterId),
      ),
    )
    .for('key share', { of: foodMasters })

  const foodsById = new Map(foodRows.map((food) => [food.id, food.name]))
  const missingFoodMaster = input.items.find(
    (item) => !foodsById.has(item.foodMasterId),
  )
  if (missingFoodMaster !== undefined) {
    return err(
      new MealSetFoodMasterNotFoundError(missingFoodMaster.foodMasterId),
    )
  }

  return ok(
    input.items.map((item) => ({
      ...item,
      foodName: foodsById.get(item.foodMasterId) ?? '',
    })),
  )
}

const insertMealSetItems = (
  session: DbSession,
  mealSetId: string,
  items: ReadonlyArray<MealSetItem>,
) =>
  session.insert(mealSetItems).values(
    items.map((item) => ({
      mealSetId,
      foodMasterId: item.foodMasterId,
      quantity: item.quantity.toString(),
    })),
  )

const loadWrittenMealSet = async (
  session: DbSession,
  mealSetId: string,
): Promise<Result<MealSet, MealSetPersistenceError>> => {
  const rawRows = await selectMealSetRows(session, eq(mealSets.id, mealSetId))
  return toMealSets(rawRows).andThen((sets) => {
    const [mealSet] = sets
    return mealSet === undefined
      ? err(
          new MealSetPersistenceError(
            `meal_set write returned no row: ${mealSetId}`,
          ),
        )
      : ok(mealSet)
  })
}

const buildPersistenceError = (
  message: string,
  caughtErr: unknown,
  name?: string,
): MealSetDomainError => {
  if (
    isUniqueViolation(caughtErr) &&
    getConstraintName(caughtErr) === 'meal_sets_name_key'
  ) {
    return new DuplicateMealSetNameError(name ?? '', caughtErr)
  }
  return new MealSetPersistenceError(message, caughtErr)
}

export const createDrizzleMealSetRepository = (
  pgSql: Sql,
  options: DrizzleMealSetRepositoryOptions = {},
): MealSetRepository => {
  const db: Db = drizzle(pgSql)
  const wrapInTransaction = options.wrapInTransaction ?? true

  const runWrite = <T>(
    operation: (session: DbSession) => Promise<Result<T, MealSetDomainError>>,
    message: string,
    name?: string,
  ): ResultAsync<T, MealSetDomainError> => {
    const promise = wrapInTransaction
      ? db.transaction((tx) => operation(tx))
      : operation(db)
    return ResultAsync.fromPromise(promise, (caughtErr) =>
      buildPersistenceError(message, caughtErr, name),
    ).andThen((result) => result)
  }

  const load = (
    where?: SQL,
  ): ResultAsync<ReadonlyArray<MealSet>, MealSetDomainError> =>
    ResultAsync.fromPromise(
      selectMealSetRows(db, where),
      (caughtErr) =>
        new MealSetPersistenceError('failed to load meal_sets', caughtErr),
    ).andThen((rawRows) => toMealSets(rawRows))

  return {
    create(input) {
      return runWrite(
        async (session) => {
          const items = await findItems(session, input)
          if (items.isErr()) return err(items.error)

          const [inserted] = await session
            .insert(mealSets)
            .values({ id: input.id, name: input.name })
            .returning({ id: mealSets.id })
          if (inserted === undefined) {
            return err(
              new MealSetPersistenceError(
                `meal_set write returned no row: ${input.id}`,
              ),
            )
          }

          await insertMealSetItems(session, input.id, items.value)
          return loadWrittenMealSet(session, input.id)
        },
        'failed to create meal_set',
        input.name,
      )
    },

    list: () => load(),

    findById(id) {
      return load(eq(mealSets.id, id)).map((sets) => sets[0] ?? null)
    },

    update(input) {
      return runWrite(
        async (session) => {
          const [existing] = await session
            .select({ id: mealSets.id })
            .from(mealSets)
            .where(eq(mealSets.id, input.id))
            .for('update')
          if (existing === undefined) {
            return err(new MealSetNotFoundError(input.id))
          }

          const items = await findItems(session, input)
          if (items.isErr()) return err(items.error)

          const [updated] = await session
            .update(mealSets)
            .set({ name: input.name })
            .where(eq(mealSets.id, input.id))
            .returning({ id: mealSets.id })
          if (updated === undefined) {
            return err(
              new MealSetPersistenceError(
                `meal_set update returned no row: ${input.id}`,
              ),
            )
          }

          await session
            .delete(mealSetItems)
            .where(eq(mealSetItems.mealSetId, input.id))
          await insertMealSetItems(session, input.id, items.value)
          return loadWrittenMealSet(session, input.id)
        },
        'failed to update meal_set',
        input.name,
      )
    },

    delete(id) {
      return ResultAsync.fromPromise(
        db.delete(mealSets).where(eq(mealSets.id, id)).returning({
          id: mealSets.id,
        }),
        (caughtErr) =>
          new MealSetPersistenceError('failed to delete meal_set', caughtErr),
      ).map((deleted) => deleted.length > 0)
    },

    searchByName(query, limit) {
      const score = sql<number>`GREATEST(
        similarity(${mealSets.name}, ${query}),
        word_similarity(${query}, ${mealSets.name})
      )`
      return ResultAsync.fromPromise(
        db
          .select({
            id: mealSets.id,
            score,
          })
          .from(mealSets)
          .where(
            sql<boolean>`
            ${mealSets.name} % ${query}
            OR ${mealSets.name} %> ${query}
            OR strpos(lower(${mealSets.name}), lower(${query})) > 0
          `,
          )
          .orderBy(desc(score), asc(mealSets.name))
          .limit(limit),
        (caughtErr) =>
          new MealSetPersistenceError('failed to search meal_sets', caughtErr),
      ).andThen((rawRows) => {
        const parsed = searchRowsSchema.safeParse(rawRows)
        if (!parsed.success) {
          return err(
            new MealSetPersistenceError(
              `meal_set search returned invalid rows: ${parsed.error.message}`,
              parsed.error,
            ),
          )
        }
        const ids = parsed.data.map((row) => row.id)
        if (ids.length === 0) {
          return okAsync([])
        }
        return load(inArray(mealSets.id, ids)).map((sets) => {
          const setsById = new Map(sets.map((set) => [set.id, set]))
          return ids.flatMap((id) => {
            const set = setsById.get(id)
            return set === undefined ? [] : [set]
          })
        })
      })
    },
  }
}
